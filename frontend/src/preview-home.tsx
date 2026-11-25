// Dev-only: the Home page with stub props and no backend. Open /preview-home.html
import ReactDOM from "react-dom/client";
import Home from "./pages/Home";
import { MascotProvider } from "./mascot";
import { SocialProvider } from "./social/SocialContext";
import "./index.css";

const noop = () => undefined;
ReactDOM.createRoot(document.getElementById("root")!).render(
  <MascotProvider avoidRight={window.innerWidth < 640 ? 8 : 170}>
    <SocialProvider>
    <Home username="neo" onOpenLab={noop} onOpenAILab={noop} onOpenTrace={noop} onOpenStudio={noop} onPlayMap={async () => "ABCDE"} onJoinCode={noop}
      onLogout={noop} onOpenSettings={noop} engineStatus="connected" />
    </SocialProvider>
  </MascotProvider>,
);
