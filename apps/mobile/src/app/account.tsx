import { useState } from "react";
import { ConfirmSheet } from "@/components/sheet";
import { Card, PasswordRow, RolePill, Row, SmallButton } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { useSession } from "@/lib/session";

/** Who you're signed in as and where, your password, and signing out. */
export default function AccountSettings() {
  const session = useSession();
  const user = session.user;
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  return (
    <SettingsPage title="Account">
      <Card>
        <Row title={user?.username ?? ""} sub={session.serverUrl ?? ""}>
          <RolePill admin={!!user?.isAdmin} />
        </Row>
        <PasswordRow />
        <Row title="Sign out" last>
          <SmallButton label="Sign out" danger onPress={() => setConfirmSignOut(true)} />
        </Row>
      </Card>
      <ConfirmSheet
        open={confirmSignOut}
        title="Sign out?"
        message="Your downloads stay on this phone, and your progress is saved on the server."
        confirmLabel="Sign out"
        onConfirm={() => void session.signOut()}
        onClose={() => setConfirmSignOut(false)}
      />
    </SettingsPage>
  );
}
