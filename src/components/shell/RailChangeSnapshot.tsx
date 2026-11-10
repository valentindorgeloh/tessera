"use client";

import { Component } from "react";
import { prepareRailChange, type NavShape } from "./nav-prefs";

type RailChangeSnapshotProps = { shape: NavShape };

/**
 * Calls `prepareRailChange` in the commit that changes what the sidebar strip shows (a view or the dock), after render
 * and before React changes the DOM (decision 149). Only a class component has `getSnapshotBeforeUpdate`; Astryx's
 * SideNav measures its rail the same way. The Sidebar renders it just before its SideNav, so it runs before the
 * SideNav's own measure and Astryx sees the mark. It covers every commit that changes the value, including the one in
 * which a sidebar that hydrated after a toggle catches up, and a SideNav that remounts for the change (its `key`).
 */
export class RailChangeSnapshot extends Component<RailChangeSnapshotProps> {
  getSnapshotBeforeUpdate(previous: Readonly<RailChangeSnapshotProps>): null {
    if (previous.shape !== this.props.shape) prepareRailChange(previous.shape, this.props.shape);
    return null;
  }

  componentDidUpdate(): void {}

  render(): null {
    return null;
  }
}
