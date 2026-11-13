"use client";

import { Copy, MoreHorizontal, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  changeStaffRoleAction,
  createStaffAction,
  resetStaffPasswordAction,
  resetStaffTwoFactorAction,
  revokeStaffSessionsAction,
  setStaffBannedAction,
} from "@/app/admin/(app)/users/actions";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/ui";

type StaffRole = "owner" | "admin" | "fulfilment";

export interface StaffView {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  banned: boolean;
  banReason: string | null;
  twoFactorEnabled: boolean;
  activeSessions: number;
  lastSignInAt: string | null;
  createdAt: string;
  isSelf: boolean;
}

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "fulfilment", label: "Fulfilment" },
];
const ROLE_HELP: Record<StaffRole, string> = {
  owner: "Everything, including settings and staff.",
  admin: "Everything except settings, staff and publishing policies.",
  fulfilment: "Orders and support cases only.",
};

const date = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function CredentialDialog({
  title,
  email,
  password,
  onClose,
}: {
  title: string;
  email: string;
  password: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={password !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Share this temporary password with {email} privately. It is shown only once and is not
            stored anywhere we can show it again. They will set up their authenticator app at first
            sign-in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border border-admin-border bg-admin-surface-2 p-3">
          <code className="min-w-0 flex-1 font-mono text-sm break-all" data-testid="temp-password">
            {password}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (password)
                void navigator.clipboard?.writeText(password).then(() => toast.success("Copied"));
            }}
          >
            <Copy aria-hidden /> Copy
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I have saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddStaffForm({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (o: boolean) => void;
  onCreated: (email: string, password: string | null) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<StaffRole>("admin");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const res = await createStaffAction({ name, email, role, password });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error);
      return;
    }
    onOpenChange(false);
    onCreated(res.data.email, res.data.tempPassword);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Add a staff member</DialogTitle>
        <DialogDescription>
          They sign in at /admin/login with a password and set up an authenticator app the first
          time.
        </DialogDescription>
      </DialogHeader>
      <Field label="Name" htmlFor="staff-name" required error={errors.name}>
        <Input
          id="staff-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
      </Field>
      <Field label="Email" htmlFor="staff-email" required error={errors.email}>
        <Input
          id="staff-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
      </Field>
      <Field label="Role" htmlFor="staff-role" hint={ROLE_HELP[role]}>
        <Select
          id="staff-role"
          value={role}
          onValueChange={(v) => setRole(v as StaffRole)}
          options={ROLE_OPTIONS}
        />
      </Field>
      <Field
        label="Temporary password"
        htmlFor="staff-password"
        error={errors.password}
        hint="Leave empty to generate a strong one. At least 12 characters if you choose your own."
      >
        <Input
          id="staff-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      {formError ? (
        <p role="alert" className="text-sm text-admin-danger">
          {formError}
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Add staff member
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The form is mounted only while the dialog is open, so it starts empty each time. */
function AddStaffDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (email: string, password: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <AddStaffForm onOpenChange={onOpenChange} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}

type Confirm =
  | { kind: "ban"; user: StaffView }
  | { kind: "unban"; user: StaffView }
  | { kind: "revoke"; user: StaffView }
  | { kind: "2fa"; user: StaffView }
  | { kind: "password"; user: StaffView };

export function UsersManager({ users, canManage }: { users: StaffView[]; canManage: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [credential, setCredential] = React.useState<{
    title: string;
    email: string;
    password: string;
  } | null>(null);
  const [pending, start] = React.useTransition();

  function changeRole(u: StaffView, role: string) {
    start(async () => {
      const res = await changeStaffRoleAction(u.id, role);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${u.name} is now ${role}. They were signed out so it applies straight away.`);
      router.refresh();
    });
  }

  async function runConfirmed() {
    if (!confirm) return;
    const { kind, user: u } = confirm;
    const res =
      kind === "ban"
        ? await setStaffBannedAction(u.id, true)
        : kind === "unban"
          ? await setStaffBannedAction(u.id, false)
          : kind === "revoke"
            ? await revokeStaffSessionsAction(u.id)
            : kind === "2fa"
              ? await resetStaffTwoFactorAction(u.id)
              : await resetStaffPasswordAction(u.id);
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    if (kind === "password" && "tempPassword" in (res.data ?? {})) {
      setCredential({
        title: "New temporary password",
        email: u.email,
        password: (res.data as { tempPassword: string }).tempPassword,
      });
    }
    toast.success(
      {
        ban: `${u.name} was deactivated and signed out`,
        unban: `${u.name} can sign in again`,
        revoke: `${u.name} was signed out everywhere`,
        "2fa": `Two-factor reset for ${u.name}. They set it up again at next sign-in.`,
        password: `Password reset for ${u.name}`,
      }[kind],
    );
    router.refresh();
  }

  const copy: Record<
    Confirm["kind"],
    { title: (u: StaffView) => string; body: string; label: string; destructive: boolean }
  > = {
    ban: {
      title: (u) => `Deactivate ${u.name}?`,
      body: "They are signed out now and cannot sign in until you reactivate them.",
      label: "Deactivate",
      destructive: true,
    },
    unban: {
      title: (u) => `Reactivate ${u.name}?`,
      body: "They can sign in again with their existing password and authenticator.",
      label: "Reactivate",
      destructive: false,
    },
    revoke: {
      title: (u) => `Sign ${u.name} out everywhere?`,
      body: "All their sessions end immediately.",
      label: "Sign out",
      destructive: true,
    },
    "2fa": {
      title: (u) => `Reset two-factor for ${u.name}?`,
      body: "Use this when they lost their authenticator. Their current code stops working, they are signed out, and they must set up a new authenticator at next sign-in.",
      label: "Reset two-factor",
      destructive: true,
    },
    password: {
      title: (u) => `Reset the password of ${u.name}?`,
      body: "A new temporary password is generated and shown to you once. They are signed out.",
      label: "Reset password",
      destructive: true,
    },
  };

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add staff member
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-admin-border bg-admin-surface shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Two-factor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} data-testid="staff-row">
                <TableCell>
                  <span className="font-medium">{u.name}</span>
                  {u.isSelf ? (
                    <span className="ml-1.5 text-xs text-admin-ink-muted">(you)</span>
                  ) : null}
                  {u.email ? (
                    <span className="block text-xs text-admin-ink-muted">{u.email}</span>
                  ) : null}
                </TableCell>
                <TableCell className="w-44">
                  {canManage && !u.isSelf ? (
                    <Select
                      aria-label={`Role of ${u.name}`}
                      value={u.role}
                      onValueChange={(v) => changeRole(u, v)}
                      options={ROLE_OPTIONS}
                      disabled={pending}
                      className="h-8"
                    />
                  ) : (
                    <Badge tone={u.role === "owner" ? "primary" : "neutral"}>
                      {ROLE_OPTIONS.find((r) => r.value === u.role)?.label}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {u.twoFactorEnabled ? (
                    <Badge tone="success">
                      <ShieldCheck aria-hidden /> On
                    </Badge>
                  ) : (
                    <Badge tone="warning">
                      <ShieldOff aria-hidden /> Not set up
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {u.banned ? (
                    <Badge tone="danger" title={u.banReason ?? undefined}>
                      Deactivated
                    </Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  )}
                  {u.activeSessions > 0 ? (
                    <span className="ml-1.5 text-xs text-admin-ink-muted">
                      {u.activeSessions} {u.activeSessions === 1 ? "session" : "sessions"}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-[13px] text-admin-ink-muted">
                  {u.lastSignInAt ? date.format(new Date(u.lastSignInAt)) : "Never"}
                </TableCell>
                <TableCell className="text-right">
                  {canManage && !u.isSelf ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setConfirm({ kind: "revoke", user: u })}>
                          Sign out everywhere
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setConfirm({ kind: "2fa", user: u })}>
                          Reset two-factor
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setConfirm({ kind: "password", user: u })}
                        >
                          Reset password
                        </DropdownMenuItem>
                        {u.banned ? (
                          <DropdownMenuItem onSelect={() => setConfirm({ kind: "unban", user: u })}>
                            Reactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            destructive
                            onSelect={() => setConfirm({ kind: "ban", user: u })}
                          >
                            Deactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AddStaffDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(email, password) => {
          toast.success(`${email} added`);
          if (password) setCredential({ title: "Staff member added", email, password });
          router.refresh();
        }}
      />
      <CredentialDialog
        title={credential?.title ?? ""}
        email={credential?.email ?? ""}
        password={credential?.password ?? null}
        onClose={() => setCredential(null)}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? copy[confirm.kind].title(confirm.user) : ""}
        description={confirm ? copy[confirm.kind].body : undefined}
        confirmLabel={confirm ? copy[confirm.kind].label : "Confirm"}
        destructive={confirm ? copy[confirm.kind].destructive : false}
        onConfirm={runConfirmed}
      />
    </div>
  );
}
