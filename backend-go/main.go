package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// Loads JWT_SECRET and ALLOWED_ORIGINS; refuses to start if the secret is weak/missing.
	if err := InitAuth(); err != nil {
		log.Fatalf("auth init failed: %v", err)
	}

	// Connect to PostgreSQL (users and logins are stored there).
	initCtx, cancelInit := context.WithTimeout(context.Background(), 30*time.Second)
	if err := InitStore(initCtx); err != nil {
		cancelInit()
		log.Fatalf("database: %v", err)
	}
	cancelInit()
	defer store.Close()

	manager := NewManager()
	hub, err := NewGameHub()
	if err != nil {
		log.Fatalf("game hub: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/signup", RegisterHandler)
	mux.HandleFunc("/api/login", LoginHandler)
	mux.HandleFunc("/ws", manager.HandleWS)
	hub.Register(mux)
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second, // slowloris protection
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		// Note: these timeouts stop applying to a connection once it is
		// upgraded to a WebSocket; ws.go manages its own deadlines.
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		certFile, keyFile := os.Getenv("TLS_CERT_FILE"), os.Getenv("TLS_KEY_FILE")
		var err error
		if certFile != "" && keyFile != "" {
			log.Printf("🚀 Learn Block Backend Engine listening on %s (TLS)", addr)
			err = srv.ListenAndServeTLS(certFile, keyFile)
		} else {
			log.Printf("⚠️  Listening on %s WITHOUT TLS. Run behind an HTTPS/WSS reverse proxy in production.", addr)
			err = srv.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
}