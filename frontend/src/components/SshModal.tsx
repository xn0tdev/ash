import { useEffect, useState } from "react";

interface SshModalProps {
  onSave: (data: {
    name: string;
    user: string;
    host: string;
    port: string;
    password: string;
  }) => void;
  onClose: () => void;
}

export default function SshModal({ onSave, onClose }: SshModalProps) {
  const [name, setName] = useState("");
  const [user, setUser] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const valid = host.trim().length > 0;

  const save = () => {
    if (!valid) return;
    onSave({
      name: name.trim(),
      user: user.trim(),
      host: host.trim(),
      port: port.trim(),
      password,
    });
  };

  const onEnter = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") save();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>New SSH host</span>
        </div>

        <div className="field">
          <label>Host</label>
          <input
            autoFocus
            value={host}
            placeholder="192.168.1.10 or my-server.com"
            spellCheck={false}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>

        <div className="field-row2">
          <div className="field">
            <label>User</label>
            <input
              value={user}
              placeholder="root"
              spellCheck={false}
              onChange={(e) => setUser(e.target.value)}
              onKeyDown={onEnter}
            />
          </div>
          <div className="field">
            <label>Port</label>
            <input
              value={port}
              placeholder="22"
              spellCheck={false}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={onEnter}
            />
          </div>
        </div>

        <div className="field">
          <label>Password (optional)</label>
          <input
            type="password"
            value={password}
            placeholder="typed automatically on connect"
            spellCheck={false}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>

        <div className="field">
          <label>Label (optional)</label>
          <input
            value={name}
            placeholder="prod server"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>

        <div className="modal-hint">
          Fingerprint prompt is skipped automatically. Hosts from ~/.ssh/config
          also appear in the list.
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
