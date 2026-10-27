import { Icon } from "./icon";

export type HeaderProps = {
  breadcrumb: string[];
  asOf: string;
  roleLabel: string;
};

// D/Header (Figma 41:2728): breadcrumb, snapshot time, View as, Ask Atlas.
export function Header({ breadcrumb, asOf, roleLabel }: HeaderProps) {
  const parents = breadcrumb.slice(0, -1);
  const current = breadcrumb[breadcrumb.length - 1];
  return (
    <header className="flex items-center gap-3 border-b border-line px-5 py-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-3">
        {parents.map((crumb) => (
          <span key={crumb} className="flex items-center gap-3">
            <span className="type-body text-fg-3">{crumb}</span>
            <Icon name="chevron-right" />
          </span>
        ))}
        <span aria-current="page" className="type-body-medium text-fg-1">
          {current}
        </span>
      </nav>
      <div className="flex-1" />
      <span className="type-caption text-fg-3">{asOf}</span>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-[5px] hover:bg-hover"
      >
        <Icon name="eye" />
        <span className="type-label text-fg-1">{roleLabel}</span>
        <Icon name="chevron-down-sm" />
      </button>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-control bg-inverse px-2.5 py-[5px]"
      >
        <Icon name="sparkles-inverse" />
        <span className="type-label text-on-inverse">Ask Atlas</span>
      </button>
    </header>
  );
}
