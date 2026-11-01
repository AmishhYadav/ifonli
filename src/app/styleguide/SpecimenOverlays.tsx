"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/Drawer";
import { Field, Input } from "@/components/ui/Field";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/money";

/** Interactive overlay demos for one column. Overlays copy the vibe / Buy scope of the column they open from. */
export function SpecimenOverlays() {
  const { toast } = useToast();
  const [qty, setQty] = useState(2);

  return (
    <div className="flex flex-wrap gap-3">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm">
            Open dialog
          </Button>
        </DialogTrigger>
        <DialogContent
          title="Notify me"
          description="We will email you once when this is back in stock. Nothing else."
          footer={
            <>
              <DialogClose asChild>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <DialogClose asChild>
                <Button size="sm">Notify me</Button>
              </DialogClose>
            </>
          }
        >
          <Field label="Email" hint="Used only for this one message.">
            <Input type="email" autoComplete="email" placeholder="you@example.com" />
          </Field>
        </DialogContent>
      </Dialog>

      <Drawer>
        <DrawerTrigger asChild>
          <Button variant="secondary" size="sm" iconStart="bag">
            Open cart drawer
          </Button>
        </DrawerTrigger>
        <DrawerContent
          title="Your bag"
          description="1 item"
          footer={
            <>
              <div className="flex items-baseline justify-between text-base">
                <span>Subtotal</span>
                <span className="font-bold">{formatINR(34900 * qty)}</span>
              </div>
              <Button fullWidth>Checkout</Button>
              <DrawerClose asChild>
                <Button variant="ghost" fullWidth>
                  Keep shopping
                </Button>
              </DrawerClose>
            </>
          }
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Heart charm</p>
              <p className="text-sm text-ink-muted">{formatINR(34900)} each</p>
            </div>
            <QuantityStepper value={qty} onChange={setQty} min={1} max={5} />
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer>
        <DrawerTrigger asChild>
          <Button variant="secondary" size="sm" iconStart="menu">
            Menu drawer
          </Button>
        </DrawerTrigger>
        <DrawerContent side="left" title="Menu">
          <nav aria-label="Sample">
            <ul className="flex flex-col gap-1">
              {["Shop", "Hippers", "DIY kits", "Track order"].map((item) => (
                <li key={item}>
                  <a href="#top" className="flex min-h-11 items-center text-lg font-semibold">
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </DrawerContent>
      </Drawer>

      <Button
        variant="secondary"
        size="sm"
        iconStart="check"
        onClick={() =>
          toast({
            title: "Added to cart",
            description: "Heart charm, qty 1",
            tone: "success",
            action: { label: "View cart", href: "#top" },
            duration: 2500,
          })
        }
      >
        Added-to-cart toast
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          toast({ title: "Could not apply code", description: "That coupon has expired.", tone: "danger" })
        }
      >
        Error toast
      </Button>
    </div>
  );
}
