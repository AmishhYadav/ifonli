"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/admin/ui";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()}>
      <Printer aria-hidden /> Print
    </Button>
  );
}
