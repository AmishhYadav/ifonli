import type { ReactNode } from "react";

import { ProductCard } from "@/components/store";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Chip, VibeChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ICON_NAMES, Icon } from "@/components/ui/Icon";
import { Price } from "@/components/ui/Price";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Radio, RadioGroup } from "@/components/ui/Radio";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";
import { VIBES } from "@/features/vibe/config";

import { COLUMN_PRODUCT } from "./sample-data";
import { SpecimenOverlays } from "./SpecimenOverlays";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-bold tracking-widest text-ink-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Every primitive once. Rendered inside a `VibeScope` per vibe and inside a Buy scope; no vibe logic here. */
export function Specimen({ column }: { column: (typeof VIBES)[number] | "buy" }) {
  return (
    <div className="flex flex-col gap-8">
      <Block title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link style</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg" iconEnd="arrow-right">
            Large
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button loading>Adding</Button>
          <Button disabled variant="secondary">
            Disabled
          </Button>
          <Button asChild variant="secondary">
            <a href="#top">As a link</a>
          </Button>
          <Tooltip content="Add to wishlist">
            <IconButton icon="heart" label="Add to wishlist" variant="secondary" />
          </Tooltip>
          <IconButton icon="search" label="Search" />
        </div>
        <Button fullWidth iconStart="bag">
          Add to bag (full width)
        </Button>
      </Block>

      <Block title="Icons and spinner">
        <div className="flex flex-wrap gap-3 text-2xl">
          {ICON_NAMES.slice(0, 18).map((name) => (
            <Icon key={name} name={name} />
          ))}
          <Spinner />
        </div>
      </Block>

      <Block title="Form">
        <Field label="Pincode" hint="6 digits, used to check delivery." required>
          <Input inputMode="numeric" placeholder="560001" autoComplete="postal-code" />
        </Field>
        <Field label="Email" error="Enter a valid email address.">
          <Input type="email" defaultValue="amish@" />
        </Field>
        <Field label="Gift note">
          <Textarea placeholder="Write something kind" rows={3} />
        </Field>
        <Field label="State">
          <Select defaultValue="ka">
            <option value="ka">Karnataka</option>
            <option value="mh">Maharashtra</option>
            <option value="dl">Delhi</option>
          </Select>
        </Field>
        <div className="flex flex-col gap-1">
          <Checkbox label="Gift wrap this order" description="Free, in kraft paper." defaultChecked />
          <Checkbox label="Email me about new drops" />
          <Switch label="Save my details" description="For faster checkout next time." defaultChecked />
        </div>
        <RadioGroup legend="Delivery" defaultValue="standard">
          <Radio value="standard" label="Standard" description="4 to 6 days" />
          <Radio value="cod" label="Cash on delivery" />
        </RadioGroup>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">Quantity</span>
          <QuantityStepper defaultValue={2} min={1} max={5} />
        </div>
      </Block>

      <Block title="Display">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success">In stock</Badge>
          <Badge tone="warning">Low stock</Badge>
          <Badge tone="danger">Failed</Badge>
          <Badge tone="sale">20% off</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>Static chip</Chip>
          <Chip selected>Selected</Chip>
          <Chip selected={false}>Toggle</Chip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {VIBES.map((v) => (
            <VibeChip key={v} vibe={v} />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <Price pricePaise={34900} mrpPaise={44900} showDiscount inclusiveOfTaxes size="lg" />
          <Price pricePaise={34900} mrpPaise={34900} />
          <Price pricePaise={79900} mrpPaise={99900} from />
        </div>
        <Card className="mb-3">
          <CardHeader>
            <CardTitle>Sticker pack</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-ink-muted">Cards take radius, border and shadow from the vibe.</p>
          </CardBody>
          <CardFooter>
            <Badge tone="accent">New</Badge>
          </CardFooter>
        </Card>
        <div className="flex gap-3" aria-hidden="true">
          <Skeleton shape="circle" className="size-12" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton shape="text" />
            <Skeleton shape="text" className="w-2/3" />
          </div>
        </div>
        <Skeleton shape="card" className="h-20 w-full" />
        <EmptyState
          icon="bag"
          title="Your bag is empty"
          action={<Button size="sm">Browse the shop</Button>}
        >
          Charms, Hippers and stickers are waiting.
        </EmptyState>
      </Block>

      <Block title="Accordion and tabs">
        <Accordion type="single" collapsible defaultValue="care">
          <AccordionItem value="care">
            <AccordionTrigger>Care</AccordionTrigger>
            <AccordionContent>Wipe with a dry cloth. Keep away from water and perfume.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="ship">
            <AccordionTrigger>Shipping</AccordionTrigger>
            <AccordionContent>Ships from India in 2 to 3 working days.</AccordionContent>
          </AccordionItem>
        </Accordion>
        <Tabs defaultValue="details">
          <TabsList aria-label="Product information">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="legal">Legal</TabsTrigger>
          </TabsList>
          <TabsContent value="details">Hand-finished, about 4 cm tall.</TabsContent>
          <TabsContent value="legal">Made in India. Net quantity: 1 piece.</TabsContent>
        </Tabs>
      </Block>

      <Block title="Overlays">
        <SpecimenOverlays />
      </Block>

      <Block title="Product card">
        <div className="max-w-[16rem]">
          <ProductCard
            product={COLUMN_PRODUCT[column]}
            sizes="256px"
            wishlist={
              <IconButton
                icon="heart"
                variant="ghost"
                size="sm"
                label={`Save ${COLUMN_PRODUCT[column].name} to wishlist`}
              />
            }
          />
        </div>
      </Block>
    </div>
  );
}
