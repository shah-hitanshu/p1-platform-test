"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useP1Router } from "../router-context";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

function getInitialTab(tabs: Tab[]): string {
  if (typeof window !== "undefined") {
    const hash = window.location.hash.slice(1);
    if (tabs.some((t) => t.id === hash)) return hash;
  }
  return tabs[0]?.id ?? "";
}

export function StructureTabs({ tabs }: { tabs: Tab[] }) {
  const [activeTab, setActiveTab] = useState(() => getInitialTab(tabs));
  const isInitialRender = useRef(true);
  const router = useP1Router();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    window.location.hash = activeTab;
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    routerRef.current.refresh();
    window.dispatchEvent(
      new CustomEvent("p1:tab-activated", { detail: { tabId: activeTab } }),
    );
  }, [activeTab]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "2px solid #e0e0e0",
          marginBottom: 16,
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? "#111" : "#666",
              background: "none",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #111" : "2px solid transparent",
              marginBottom: -2,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} style={{ display: activeTab === tab.id ? "block" : "none" }}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
