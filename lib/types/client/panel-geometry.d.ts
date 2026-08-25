export type PanelMode = 'docked' | 'floating';
export type PanelResizeEdge = 'left' | 'bottom' | 'corner';
export interface PanelBounds {
    readonly width: number;
    readonly height: number;
    readonly anchorRight: number;
}
export interface PanelLayout {
    readonly mode: PanelMode;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly manualHeight: boolean;
}
export interface PanelGeometry {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export declare const PANEL_LAYOUT_STORAGE_KEY = "dsh-agent-team:activity-panel:v1";
export declare const PANEL_COMPACT_BREAKPOINT = 960;
export declare const PANEL_DEFAULT_WIDTH = 388;
export declare const PANEL_DEFAULT_HEIGHT = 640;
export declare const PANEL_MIN_WIDTH = 320;
export declare const PANEL_MAX_WIDTH = 640;
export declare const PANEL_MIN_HEIGHT = 360;
export declare const PANEL_DOCK_TOP = 64;
export declare const PANEL_DOCK_RIGHT = 18;
export declare const PANEL_DOCK_BOTTOM = 48;
export declare const PANEL_FLOAT_MARGIN = 12;
export declare const DEFAULT_PANEL_LAYOUT: PanelLayout;
export declare function parsePanelLayout(value: string): PanelLayout;
export declare function compactPanelForBounds(bounds: PanelBounds): boolean;
export declare function panelUsesAutoHeight(layout: PanelLayout): boolean;
export declare function panelMaximumHeight(layout: PanelLayout, bounds: PanelBounds): number;
export declare function resolvePanelGeometry(layout: PanelLayout, bounds: PanelBounds): PanelGeometry;
export declare function floatPanelLayout(layout: PanelLayout, bounds: PanelBounds): PanelLayout;
export declare function dockPanelLayout(layout: PanelLayout, bounds: PanelBounds): PanelLayout;
export declare function movePanelLayout(layout: PanelLayout, dx: number, dy: number, bounds: PanelBounds): PanelLayout;
export declare function resizePanelLayout(layout: PanelLayout, edge: PanelResizeEdge, dx: number, dy: number, bounds: PanelBounds): PanelLayout;
//# sourceMappingURL=panel-geometry.d.ts.map