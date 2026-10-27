import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { requirePageUser } from "@/server/session";
import { youProps } from "@/server/you";
import { ProfileView } from "@/web/profile/profile-view";
import { settingsSection } from "@/web/profile/sections";

/** One settings group from You, on its own page, as in the app. */
export default async function YouSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const user = await requirePageUser();
  const section = settingsSection((await params).section, user.isAdmin);
  if (!section) notFound();
  return <ProfileView section={section} {...await youProps(await getContext(), user)} />;
}
