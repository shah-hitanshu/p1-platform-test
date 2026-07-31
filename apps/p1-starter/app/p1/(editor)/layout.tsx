import "@puckeditor/core/puck.css";
import { pages } from "./[[...p1]]/p1-pages";

// The editor renders from this layout, NOT the page. The (editor) group is a
// static segment, so this layout survives navigation between /p1/<pageA> and
// /p1/<pageB> — a layout inside [[...p1]] would remount on every switch, since
// Next keys segment cache nodes by param value.
//
// Scoping the layout to the (editor) group (instead of app/p1/layout.tsx) is
// what keeps the editor off sibling routes: /p1/merge and future pages like
// /p1/settings live outside the group and never render the editor. Add such
// pages as siblings of (editor), not inside it.
export default pages.Layout;
