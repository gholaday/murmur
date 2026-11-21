import { redirect } from "next/navigation";
import { getContext } from "@/server/context";
import { getPrefs } from "@/server/prefs";
import { requirePageUser } from "@/server/session";
import { youProps } from "@/server/you";
import { AdminProvider } from "@/web/admin";
import { Welcome } from "@/web/welcome/welcome";

/** The first-run steps, once per person; done or skipped, it goes to the library. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  // TEMPORARY, for testing: /welcome?preview shows the steps again and saves nothing at the end. Remove before release.
  const preview = (await searchParams).preview !== undefined;
  if (getPrefs(ctx, user.id).onboarded && !preview) redirect("/");
  const props = await youProps(ctx, user);
  const following = (ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?").get(user.id) as { n: number }).n;
  return (
    <AdminProvider isAdmin={user.isAdmin} tmdb={!!ctx.watch.tmdb}>
      <Welcome
        isAdmin={user.isAdmin}
        tabs={props.tabs}
        books={props.books}
        music={props.music}
        watch={props.watch}
        following={following}
        libraryAdmin={props.libraryAdmin}
        folders={props.folders}
        musicFolders={props.musicFolders}
        videoFolders={[...props.movieFolders, ...props.showFolders]}
        version={props.server.version}
        devBuild={props.server.devBuild}
        preview={preview}
      />
    </AdminProvider>
  );
}
