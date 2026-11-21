// Dev-only: every room screen from fixtures, no backend. Run `npm run dev` and open /preview-rooms.html
import ReactDOM from "react-dom/client";
import { MascotProvider } from "./mascot";
import { Preview } from "./game/dev/Preview";
import "./index.css";
import "./game/rooms.css";
import "./game/relic.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <MascotProvider avoidRight={170}>
    <Preview />
  </MascotProvider>,
);
