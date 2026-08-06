"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel, Input } from "@/components/ui/input";
import { ThemeControl } from "@/components/profile/theme-control";
import { signOut, updateDisplayName } from "@/lib/actions/auth";

export function ProfileForm({
  displayName,
  isAnonymous,
  memberSince,
}: {
  displayName: string;
  isAnonymous: boolean;
  memberSince: string;
}) {
  const [name, setName] = useState(displayName);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Card className="gap-0 flex-row items-center gap-x-3 px-4">
        <Avatar name={displayName} className="size-12 text-base" />
        <div>
          <div className="font-serif text-lg">{displayName}</div>
          <div className="text-xs text-muted-foreground">
            {isAnonymous
              ? "Playing as a guest — sign in to keep your history"
              : `Member since ${new Date(memberSince).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`}
          </div>
        </div>
      </Card>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await updateDisplayName(name);
            if (result.error) toast.error(result.error);
            else toast.success("Name updated on the card.");
          });
        }}
      >
        <div>
          <FieldLabel htmlFor="display-name">Name on the card</FieldLabel>
          <Input
            id="display-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          Save
        </Button>
      </form>

      <div>
        <FieldLabel>Appearance</FieldLabel>
        <ThemeControl />
      </div>

      <Button
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(() => signOut())}
      >
        Sign out
      </Button>
    </>
  );
}
