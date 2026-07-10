import { Component, ReactNode } from "react";

// Catches render-time errors (the startup overlay only covers main()'s async
// boot). A component calling .map on null blew up during the first paint in
// the Wails port; without this the minified stack hid which component. The
// boundary renders the error + React componentStack on-screen so the cause is
// visible without a devtools session.
interface State {
  error: Error | null;
  componentStack: string | null;
}
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, componentStack: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("render error:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack });
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            fontFamily: "Consolas, monospace",
            color: "#ff6369",
            background: "#0a0a0a",
            padding: 24,
            fontSize: 13,
            whiteSpace: "pre-wrap",
            minHeight: "100vh",
          }}
        >
          <div style={{ color: "#fff", marginBottom: 12 }}>Ash crashed during render:</div>
          {String(this.state.error)}
          {"\n\n"}
          {this.state.error.stack ?? ""}
          {"\n\n--- component stack ---\n"}
          {this.state.componentStack ?? "(none)"}
        </div>
      );
    }
    return this.props.children;
  }
}
