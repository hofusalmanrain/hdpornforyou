import { Link, useLocation } from "react-router";
import { Home, Flame, Compass, Search, User } from "lucide-react";
import { saveScrollPosition } from "@/lib/scroll-memory";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";

export function MobileNav() {
  const visible = useHideOnScroll({ hideAfter: 72, threshold: 8 });
  return (
    <nav
      className={`md:hidden fixed bottom-0 inset-x-0 z-[110] glass-strong border-t border-border rounded-t-[24px] overflow-hidden supports-[backdrop-filter]:backdrop-blur-2xl supports-[backdrop-filter]:backdrop-saturate-150 shadow-[0_-8px_32px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.10)] pb-[env(safe-area-inset-bottom)] will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${visible ? "translate-y-0" : "translate-y-[110%]"}`}
    >
      <div className="grid grid-cols-5">
        <Tab to="/" icon={<Home className="h-5 w-5" />} label="Home" />
        <Tab to="/trending" icon={<Flame className="h-5 w-5" />} label="Trending" />
        <Tab to="/explore" icon={<Compass className="h-5 w-5" />} label="Explore" />
        <Tab to="/search" icon={<Search className="h-5 w-5" />} label="Search" />
        <Tab to="/account" icon={<User className="h-5 w-5" />} label="Account" />
      </div>
    </nav>
  );
}

function Tab({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const location = useLocation();
  const isActive =
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      onPointerDown={() => saveScrollPosition()}
      onClick={() => saveScrollPosition()}
      aria-current={isActive ? "page" : undefined}
      className={`flex touch-manipulation flex-col items-center justify-center gap-1 py-3.5 text-[11px] font-medium transition-all duration-200 ${
        isActive
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground active:scale-95"
      }`}
    >
      <span className={`transition-transform duration-200 ${isActive ? "scale-110" : ""}`}>{icon}</span>
      <span className={isActive ? "font-semibold" : ""}>{label}</span>
    </Link>
  );
}
