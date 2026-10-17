
"use client";
import { useEffect } from "react";

export default function LoginRedirect() {
  useEffect(() => {
    window.location.href = "https://kovalio.nextrium.org/login";
  }, []);
  return null;
}
