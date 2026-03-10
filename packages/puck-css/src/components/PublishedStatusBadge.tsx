export interface PublishedStatusBadgeProps {
  status: "published" | "unpublished-changes" | "draft";
  className?: string;
}

const STATUS_CONFIG = {
  published: {
    dotClass: "pds-status-badge__status--success",
    screenReaderLabel: "Status indicator: success",
    label: "Published",
  },
  "unpublished-changes": {
    dotClass: "pds-status-badge__status--warning",
    screenReaderLabel: "Status indicator: warning",
    label: "Unpublished changes",
  },
  draft: {
    dotClass: null,
    screenReaderLabel: null,
    label: "Draft",
  },
} as const;

export function PublishedStatusBadge({
  status,
  className,
}: PublishedStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const baseClass = "pds-status-badge pds-status-badge--transparent";
  const combinedClass = className ? `${baseClass} ${className}` : baseClass;

  return (
    <div className={combinedClass}>
      {config.dotClass && (
        <span
          className={`pds-status-badge__status ${config.dotClass}`}
        >
          <span className="visually-hidden">
            {config.screenReaderLabel}
          </span>
        </span>
      )}
      <span className="pds-status-badge__label">{config.label}</span>
    </div>
  );
}
