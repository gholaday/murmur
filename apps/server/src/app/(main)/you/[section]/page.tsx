import { notFound, redirect } from "next/navigation";
import { SETTINGS_TABS, settingsTabFor } from "@murmur/shared";
import { getContext } from "@/server/context";
import { requirePageUser } from "@/server/session";
import { youProps } from "@/server/you";
import { ProfileView } from "@/web/profile/profile-view";

/** You with one settings tab open, so a tab can be linked; /you/hidden is what you hid. */
export default async function YouSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const user = await requirePageUser();
  const id = (await params).section;
  const props = await youProps(await getContext(), user);
  if (id === "hidden") return <ProfileView tab="hidden" {...props} />;
  const tab = settingsTabFor(id);
  if (!tab || (SETTINGS_TABS.find((t) => t.id === tab)?.admin && !user.isAdmin)) notFound();
  if (tab !== id) redirect(`/you/${tab}`);
  return <ProfileView tab={tab} {...props} />;
}
