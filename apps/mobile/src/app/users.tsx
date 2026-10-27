import { UsersSection } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { useSession } from "@/lib/session";

/** Admin: who can sign in, adding and removing them. */
export default function UsersSettings() {
  const user = useSession().user;
  return <SettingsPage title="Users">{user ? <UsersSection me={user} /> : null}</SettingsPage>;
}
