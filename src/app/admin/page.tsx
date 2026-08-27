import AdminClient from "@/components/AdminClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Commissioner Control Room",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPage() {
  return <AdminClient />;
}
