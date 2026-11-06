import { getContext } from "@/server/context";
import { getPrefs } from "@/server/prefs";
import { requirePageUser } from "@/server/session";
import { SearchView } from "@/web/search/search-view";

export default async function SearchPage() {
  const user = await requirePageUser();
  return <SearchView tabs={getPrefs(await getContext(), user.id).tabs} />;
}
