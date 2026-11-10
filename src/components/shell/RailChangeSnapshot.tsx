"use client";

import { Component } from "react";
import { prepareRailChange } from "./nav-collapse-store";

type RailChangeSnapshotProps = { isCollapsed: boolean };

/**
 * Calls `prepareRailChange` in the commit that changes the sidebar's collapse
 * state, after render and before React changes the DOM (decision 149). Only a
 * class component has `getSnapshotBeforeUpdate`; Astryx's SideNav measures its
 * rail the same way. The Sidebar renders it just before its SideNav, so it runs
 * before the SideNav's own measure and Astryx sees the mark. It covers every
 * commit that changes the value, including the one in which a sidebar that
 * hydrated after a toggle catches up.
 */
export class RailChangeSnapshot extends Component<RailChangeSnapshotProps> {
  getSnapshotBeforeUpdate(previous: Readonly<RailChangeSnapshotProps>): null {
    if (previous.isCollapsed !== this.props.isCollapsed) prepareRailChange(this.props.isCollapsed);
    return null;
  }

  componentDidUpdate(): void {}

  render(): null {
    return null;
  }
}
