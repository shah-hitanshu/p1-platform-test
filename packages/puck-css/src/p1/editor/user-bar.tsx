"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AuthTokens, DeviceCodeResponse, UserInfo } from "../../data/auth";
import { ghostButton, primaryButton } from "../../data/styles";
import {
  clearTokens,
  getValidTokens,
  getUserInfo,
  pollForToken,
  startDeviceFlow,
  storeTokens,
} from "../../data/auth";

type AuthState =
  | { status: "loading" }
  | { status: "logged-out"; error?: string }
  | { status: "device-flow"; deviceCode: DeviceCodeResponse }
  | { status: "logged-in"; user: UserInfo };

export function UserBar() {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getValidTokens().then((tokens) => {
      if (tokens) {
        setState({ status: "logged-in", user: getUserInfo(tokens) });
      } else {
        setState({ status: "logged-out" });
      }
    });
    return () => abortRef.current?.abort();
  }, []);

  const handleLogin = useCallback(async () => {
    try {
      const deviceCode = await startDeviceFlow();
      setState({ status: "device-flow", deviceCode });

      window.open(
        deviceCode.verification_uri_complete || deviceCode.verification_uri,
        "_blank"
      );

      abortRef.current = new AbortController();
      const tokens: AuthTokens = await pollForToken(
        deviceCode.device_code,
        deviceCode.interval || 5,
        abortRef.current.signal
      );
      storeTokens(tokens);
      setState({ status: "logged-in", user: getUserInfo(tokens) });
    } catch (err) {
      if ((err as Error).message !== "Aborted") {
        console.error("Login failed:", err);
        setState({ status: "logged-out", error: (err as Error).message || "Login failed" });
      }
    }
  }, []);

  const handleLogout = useCallback(() => {
    abortRef.current?.abort();
    clearTokens();
    setState({ status: "logged-out" });
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 12,
        padding: "6px 16px",
        background: "#1b1b1b",
        color: "#e0e0e0",
        fontSize: 13,
        fontFamily: "system-ui, sans-serif",
        borderBottom: "1px solid #333",
      }}
    >
      {state.status === "loading" && (
        <span style={{ opacity: 0.5 }}>Loading...</span>
      )}

      {state.status === "logged-out" && (
        <>
          <button
            onClick={handleLogin}
            style={{ ...primaryButton, padding: "4px 12px" }}
          >
            Log in
          </button>
          {state.error && (
            <span style={{ color: "#f87171", fontSize: 12 }}>
              {state.error}
            </span>
          )}
        </>
      )}

      {state.status === "device-flow" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.7 }}>
            Enter code{" "}
            <strong style={{ color: "#fff", letterSpacing: 1 }}>
              {state.deviceCode.user_code}
            </strong>{" "}
            in the browser tab that opened
          </span>
          <button
            onClick={() => {
              abortRef.current?.abort();
              setState({ status: "logged-out" });
            }}
            style={{ ...ghostButton, color: "#888", border: "1px solid #555", fontSize: 12 }}
          >
            Cancel
          </button>
        </div>
      )}

      {state.status === "logged-in" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {state.user.picture ? (
            <img
              src={state.user.picture}
              alt=""
              referrerPolicy="no-referrer"
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
              }}
            />
          ) : (
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: "#555",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: "#fff",
              }}
            >
              {(state.user.name || state.user.email || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <span style={{ opacity: 0.9 }}>
            {state.user.name || state.user.email || "User"}
          </span>
          <button
            onClick={handleLogout}
            style={{ ...ghostButton, color: "#888", border: "1px solid #555", fontSize: 12, marginLeft: 4 }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
