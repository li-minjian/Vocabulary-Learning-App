/** Session routes take priority over content routes, including historical bookmarks. */
export function navigationSection(path: string): string {
 if (/^\/(learn|practice|review)(\/|$)/.test(path) || /^\/exercises\/session(\/|$)/.test(path)) return 'learn';
 if (/^\/(library|vocabulary|exercises|collections)(\/|$)/.test(path)) return 'library';
 if (/^\/import(\/|$)/.test(path)) return 'import';
 if (/^\/statistics(\/|$)/.test(path)) return 'statistics';
 if (/^\/settings(\/|$)/.test(path)) return 'settings';
 return 'dashboard';
}
