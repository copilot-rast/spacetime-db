export function GamesCatalog(props: { ro?: boolean; accountId?: bigint }) {
  return <main className="page" data-testid="page-GamesCatalog">{props.ro ? null : null}</main>;
}

export function GameEditPage(props: { ro?: boolean; accountId?: bigint }) {
  return <main className="page" data-testid="page-GameEditPage">{props.ro ? null : null}</main>;
}

export function GameServers(props: { ro?: boolean; accountId?: bigint }) {
  return <main className="page" data-testid="page-GameServers">{props.ro ? null : null}</main>;
}

export function GamesSettingsSection(props: { ro?: boolean; accountId?: bigint }) {
  return <main className="page" data-testid="page-GamesSettingsSection">{props.ro ? null : null}</main>;
}

