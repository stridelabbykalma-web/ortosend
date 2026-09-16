"use client";

// Consentimiento de cookies (LSSI/AEPD). La única cookie no técnica es la de
// Google Maps, así que la elección controla exclusivamente la carga del mapa.
import { useEffect, useState } from "react";

const KEY = "ortosend-cookies-v1";
const EVENT = "ortosend-cookies-changed";

export type CookieChoice = "all" | "essential" | null;

export function getCookieChoice(): CookieChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "all" || v === "essential" ? v : null;
  } catch {
    return null;
  }
}

export function setCookieChoice(v: Exclude<CookieChoice, null>) {
  try {
    localStorage.setItem(KEY, v);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function useCookieChoice(): CookieChoice {
  const [choice, setChoice] = useState<CookieChoice>(null);
  useEffect(() => {
    const read = () => setChoice(getCookieChoice());
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);
  return choice;
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(getCookieChoice() === null);
    const onChange = () => setVisible(getCookieChoice() === null);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  if (!visible) return null;
  return (
    <div
      role="dialog"
      aria-label="Aviso de cookies"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        background: "#fff",
        borderTop: "1px solid var(--line)",
        boxShadow: "0 -4px 16px rgba(23,38,46,.08)",
        padding: "14px 20px",
      }}
    >
      <div className="wrap row between" style={{ gap: 14 }}>
        <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: "var(--ink2)" }}>
          Usamos una cookie técnica de sesión y, solo si lo aceptas, las cookies de{" "}
          <b>Google Maps</b> para mostrarte el mapa de clínicas. Sin aceptarlas puedes usar toda la
          web buscando por población o código postal.{" "}
          <a href="/legal/cookies">Política de cookies</a>
        </div>
        <div className="row">
          <button type="button" onClick={() => setCookieChoice("essential")}>
            Solo esenciales
          </button>
          <button type="button" className="pri" onClick={() => setCookieChoice("all")}>
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
