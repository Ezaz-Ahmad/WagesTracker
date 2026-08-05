import { useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "./icons";

/**
 * A password `<input>` with a show/hide toggle. Drop-in replacement for
 * `<input className="input" type="password" .../>` — accepts the same props
 * (value, onChange, onKeyDown, required, minLength, autoFocus, etc.).
 */
export function PasswordInput({ className = "input", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-field">
      <input {...props} type={visible ? "text" : "password"} className={`${className} input-password`} />
      <button
        type="button"
        className="password-toggle-btn"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
      </button>
    </div>
  );
}
