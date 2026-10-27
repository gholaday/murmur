import { getContext } from "@/server/context";
import { requirePageUser } from "@/server/session";
import { youProps } from "@/server/you";
import { ProfileView } from "@/web/profile/profile-view";

export default async function YouPage() {
  const user = await requirePageUser();
  return <ProfileView {...await youProps(await getContext(), user)} />;
}
