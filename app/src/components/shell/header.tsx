import Link from "next/link";
import { AskAtlasLink } from "./ask-atlas";
import { Icon } from "./icon";

/** A crumb with an href goes back there ("Today" from a review goes back to its chat). */
export type Crumb = string | { label: string; href: string };

export type HeaderProps = {
  breadcrumb: Crumb[];
  asOf: string;
  roleLabel: string;
  /** The View as menu (L0); a plain button when not given. */
  roleMenu?: React.ReactNode;
};

// D/Header (Figma 41:2728): breadcrumb, snapshot time, View as, Ask Atlas.
export function Header({ breadcrumb, asOf, roleLabel, roleMenu }: HeaderProps) {
  const parents = breadcrumb.slice(0, -1);
  const current = breadcrumb[breadcrumb.length - 1];
  return (
    <header className="flex items-center gap-3 border-b border-line px-5 py-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-3">
        {parents.map((crumb) => {
          const label = typeof crumb === "string" ? crumb : crumb.label;
          return (
            <span key={label} className="flex items-center gap-3">
              {typeof crumb === "string" ? (
                <span className="type-body text-fg-3">{label}</span>
              ) : (
                <Link href={crumb.href} className="type-body text-fg-3 hover:text-fg-1 hover:underline">
                  {label}
                </Link>
              )}
              <Icon name="chevron-right" />
            </span>
          );
        })}
        <span aria-current="page" className="type-body-medium text-fg-1">
          {typeof current === "string" ? current : current.label}
        </span>
      </nav>
      <div className="flex-1" />
      <span className="type-caption text-fg-3">{asOf}</span>
      {roleMenu ?? (
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-[5px] hover:bg-hover"
        >
          <Icon name="eye" />
          <span className="type-label text-fg-1">{roleLabel}</span>
          <Icon name="chevron-down-sm" />
        </button>
      )}
      <AskAtlasLink className="flex items-center gap-1.5 rounded-control bg-inverse px-2.5 py-[5px]">
        <Icon name="sparkles-inverse" />
        <span className="type-label text-on-inverse">Ask Atlas</span>
      </AskAtlasLink>
    </header>
  );
}
