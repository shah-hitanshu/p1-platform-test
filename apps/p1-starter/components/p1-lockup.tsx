"use client";

import { P1_ASSETS } from "../constants/assets";
import styles from "./welcome-block.module.css";

export function P1Lockup() {
  return (
    <img
      src={P1_ASSETS.LOGO_URL}
      alt="Pantheon P1"
      className={styles.lockup}
    />
  );
}
