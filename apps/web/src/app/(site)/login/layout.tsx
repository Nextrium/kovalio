import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Kovalio account.",
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: "https://kovalio.nextrium.org/login" },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
