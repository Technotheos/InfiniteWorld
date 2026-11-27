package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestNoSQLBuiltFromStrings is a tripwire for SQL injection. Every query in this
// server passes user input as $1, $2... parameters. This test parses the source
// and fails if a database call receives anything other than a plain string
// literal as its SQL text, or if SQL keywords appear next to fmt.Sprintf / "+".
//
// If it fails: do not silence it. Use a parameter, or (for identifiers such as
// column names) pick from a fixed allowlist in code and add a justified
// exception below.
func TestNoSQLBuiltFromStrings(t *testing.T) {
	sqlCalls := map[string]int{ // method name -> index of the SQL argument
		"Exec": 1, "Query": 1, "QueryRow": 1, "execOne": 1,
	}
	sqlWord := regexp.MustCompile(`(?i)\b(select|insert\s+into|update|delete\s+from|drop|alter|create\s+table)\b`)

	files, _ := filepath.Glob("*.go")
	fset := token.NewFileSet()
	checked := 0
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			// 1. DB calls must take a literal as the SQL text.
			if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
				if idx, isSQL := sqlCalls[sel.Sel.Name]; isSQL && len(call.Args) > idx {
					if _, isLit := call.Args[idx].(*ast.BasicLit); !isLit {
						// the pgStore.execOne wrapper forwards its own parameter; allow only that
						if id, isIdent := call.Args[idx].(*ast.Ident); !(isIdent && id.Name == "sql" && path == "store_profile.go") {
							t.Errorf("%s: %s: SQL passed to %s is not a string literal", path, fset.Position(call.Pos()), sel.Sel.Name)
						}
					}
					checked++
				}
			}
			// 2. fmt.Sprintf / Sprint building SQL.
			if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
				if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "fmt" && strings.HasPrefix(sel.Sel.Name, "Sprint") && len(call.Args) > 0 {
					if lit, ok := call.Args[0].(*ast.BasicLit); ok && sqlWord.MatchString(lit.Value) {
						t.Errorf("%s: %s: fmt.%s used to build SQL", path, fset.Position(call.Pos()), sel.Sel.Name)
					}
				}
			}
			return true
		})
		// 3. string concatenation with SQL text.
		ast.Inspect(f, func(n ast.Node) bool {
			be, ok := n.(*ast.BinaryExpr)
			if !ok || be.Op != token.ADD {
				return true
			}
			for _, side := range []ast.Expr{be.X, be.Y} {
				if lit, ok := side.(*ast.BasicLit); ok && lit.Kind == token.STRING && sqlWord.MatchString(lit.Value) &&
					strings.Contains(strings.ToLower(lit.Value), " from ") {
					t.Errorf("%s: %s: SQL text concatenated with +", path, fset.Position(be.Pos()))
				}
			}
			return true
		})
	}
	if checked < 20 {
		t.Fatalf("guard looks broken: only %d database calls inspected", checked)
	}
}

// TestInjectionPayloadsAreInert runs hostile strings through the real handlers.
func TestInjectionPayloadsAreInert(t *testing.T) {
	profileSetup(t)
	payloads := []string{
		"' OR '1'='1", "'; DROP TABLE users;--", "admin'--", "\" OR \"\"=\"", "1; SELECT pg_sleep(5)",
		"%' OR 1=1 --", "robert'); DROP TABLE users;--",
	}
	for _, p := range payloads {
		// login
		w := do(LoginHandler, formReq(http.MethodPost, "/api/login", "", urlValues("username", p, "password", p)))
		if w.Code != http.StatusUnauthorized {
			t.Errorf("login with %q: got %d", p, w.Code)
		}
		// signup is refused by the allowlist regex, not by luck
		w = do(RegisterHandler, formReq(http.MethodPost, "/api/signup", "", urlValues("username", p, "password", "correct horse battery")))
		if w.Code != http.StatusBadRequest {
			t.Errorf("signup with %q: got %d", p, w.Code)
		}
	}
}

func urlValues(kv ...string) url.Values {
	v := url.Values{}
	for i := 0; i+1 < len(kv); i += 2 {
		v.Set(kv[i], kv[i+1])
	}
	return v
}
