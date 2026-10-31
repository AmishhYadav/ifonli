import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PrintButton } from "@/components/admin/orders/PrintButton";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getPackingSlip } from "@/server/services/admin/orders";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Packing slip" };

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * Printable packing slip: plain HTML, no prices and no payment details, outside the admin shell so
 * the sidebar never lands on paper. Needs `order:packing_slip` (fulfilment staff hold it).
 */
export default function PackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading…</p>}>
      <Slip params={params} />
    </Suspense>
  );
}

async function Slip({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin("order:packing_slip");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const slip = await getPackingSlip(getDb(), id, { role: session.user.role });
  if (!slip) notFound();
  const a = slip.address;
  const units = slip.items.reduce((s, i) => s + i.qty, 0);

  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-black print:max-w-none print:p-0" style={{ colorScheme: "light" }}>
      <style>{"@media print { @page { margin: 14mm; } }"}</style>
      <div className="mb-6 flex items-start justify-between print:hidden">
        <p className="text-sm text-neutral-600">Packing slip for {slip.ref}</p>
        <PrintButton />
      </div>

      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Packing slip</h1>
          <p className="mt-1 font-mono text-lg">{slip.ref}</p>
        </div>
        <p className="text-right text-sm">
          Order date {dateFmt.format(slip.placedAt)}
          <br />
          {units} item{units === 1 ? "" : "s"} · {slip.items.length} line{slip.items.length === 1 ? "" : "s"}
        </p>
      </header>

      <section className="my-5 grid grid-cols-2 gap-6 text-sm">
        <div>
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-neutral-600 uppercase">Ship to</h2>
          <address className="text-base leading-snug not-italic">
            <strong>{a.name}</strong>
            {[a.line1, a.line2, a.landmark, [a.city, a.pincode].filter(Boolean).join(" "), a.state].filter(Boolean).map((l, i) => (
              <span key={i} className="block">
                {l}
              </span>
            ))}
            {a.phone ? <span className="mt-1 block">Phone {a.phone}</span> : null}
          </address>
        </div>
        <div>
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-neutral-600 uppercase">Dispatch</h2>
          {slip.shipment ? (
            <p className="text-base">
              {slip.shipment.courier}
              {slip.shipment.awb ? <span className="block font-mono">AWB {slip.shipment.awb}</span> : null}
            </p>
          ) : (
            <p className="text-neutral-600">Courier not assigned yet</p>
          )}
          {slip.paymentMethod === "cod" ? (
            <p className="mt-2 inline-block border-2 border-black px-2 py-0.5 text-sm font-bold">CASH ON DELIVERY</p>
          ) : null}
        </div>
      </section>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-black text-left text-xs tracking-wide uppercase">
            <th className="w-20 py-2 pr-2">Packed</th>
            <th className="py-2">Item</th>
            <th className="py-2">SKU</th>
            <th className="w-16 py-2 text-right">Qty</th>
          </tr>
        </thead>
        <tbody>
          {slip.items.map((i, idx) => (
            <tr key={idx} className="border-b border-neutral-300">
              <td className="py-3">
                <span className="inline-block size-4 border-2 border-black align-middle" />
              </td>
              <td className="py-3 text-base">
                {i.productName}
                {i.variantTitle !== "Default" ? <span className="block text-sm text-neutral-600">{i.variantTitle}</span> : null}
              </td>
              <td className="py-3 font-mono">{i.sku}</td>
              <td className="py-3 text-right text-xl font-bold tabular-nums">{i.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-xs text-neutral-600">Thank you for choosing IfOnli. Questions about this order? Quote {slip.ref}.</p>
    </main>
  );
}
