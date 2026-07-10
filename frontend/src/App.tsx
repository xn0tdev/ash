import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { EventsOn } from "../wailsjs/runtime";
import { OpenPTY, WritePTY, ResizePTY } from "../wailsjs/go/main/Pty";
import TitleBar from "./TitleBar";
import "@xterm/xterm/css/xterm.css";
import "./App.css";

// Spike shell: frameless titlebar + a single xterm pane wired to the Go
// ConPTY bridge. PTY output arrives as Wails events ("pty:<id>"); keystrokes
// flow back through WritePTY. This is the minimum to feel whether the Wails
// stack + Go backend is pleasant before committing to a full port.
export default function App() {
  const termRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>("");
  // Status is debug-only here; not rendered in the spike shell.

  useEffect(() => {
    if (!termRef.current) return;
    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#0a0a0a",
        foreground: "#ececec",
        cursor: "#ececec",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    fit.fit();

    const cols = term.cols;
    const rows = term.rows;

    // Open a ConPTY on the Go side; we get back an id to address it by.
    OpenPTY("", cols, rows)
      .then((id: string) => {
        idRef.current = id;
        // Stream: ConPTY output → xterm writes.
        EventsOn("pty:" + id, (data: string) => term.write(data));
        EventsOn("pty:" + id + ":done", () => {});
        // Keystrokes → PTY stdin.
        const disp = term.onData((d) => WritePTY(id, d).catch(() => {}));
        // Keep the dispose handle for cleanup.
        (term as any)._disp = disp;
      })
      .catch((e: unknown) => console.error("open pty:", e));

    // Resize the PTY when the pane geometry changes.
    const ro = new ResizeObserver(() => {
      fit.fit();
      if (idRef.current) ResizePTY(idRef.current, term.cols, term.rows).catch(() => {});
    });
    ro.observe(termRef.current);

    return () => {
      ro.disconnect();
      (term as any)._disp?.dispose();
      term.dispose();
    };
  }, []);

  return (
    <div id="App" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TitleBar />
      <div className="term-container" ref={termRef} />
    </div>
  );
}
