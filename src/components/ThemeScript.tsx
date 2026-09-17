import { THEME_KEY } from "@/components/theme-shared";

/** Apply .dark before hydration. Without this, users with a dark setting see a white flash
 *  on the first render.
 *
 *  It matters that this is a server component. Inside "use client", React warns that scripts
 *  are not executed during client rendering. All we need here is for the script to be in the
 *  HTML the server sends. */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)})||"system";
var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
