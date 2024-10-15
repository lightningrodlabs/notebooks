import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { SynStore, SynClient } from "@holochain-syn/core";

import { localized, msg } from "@lit/localize";

import "@holochain-syn/core/dist/elements/syn-context.js";
import "@holochain-open-dev/profiles/dist/elements/profiles-context.js";
import "@holochain-open-dev/elements/dist/elements/display-error.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";

import "@lightningrodlabs/notebooks/dist/elements/markdown-note.js";
import "@lightningrodlabs/notebooks/dist/elements/all-notes.js";

import { sharedStyles } from "@holochain-open-dev/elements";
import { AppClient, DnaHash, EntryHash } from "@holochain/client";
import { ProfilesClient, ProfilesStore } from "@holochain-open-dev/profiles";
import { lazyLoad, StoreSubscriber } from "@holochain-open-dev/stores";
import {
  AppletInfo,
  getAppletsInfosAndGroupsProfiles,
  GroupProfile,
  WeServices,
  weServicesContext,
} from "@theweave/api";
import { consume } from "@lit-labs/context";
import { CellType } from "@holochain/client";

@localized()
@customElement("cross-applet-main")
export class CrossAppletMain extends LitElement {
  @property()
  applets!: ReadonlyMap<
    EntryHash,
    { appletClient: AppClient; profilesClient: ProfilesClient }
  >;

  @consume({ context: weServicesContext, subscribe: true })
  weServices!: WeServices;

  appletsInfo = new StoreSubscriber(
    this,
    () =>
      lazyLoad(async () =>
        getAppletsInfosAndGroupsProfiles(
          this.weServices,
          Array.from(this.applets.keys())
        )
      ),
    () => []
  );

  renderNotes(
    applets: ReadonlyMap<EntryHash, AppletInfo>,
    groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>
  ) {
    return html`
      <div class="flex-scrollable-parent" style="margin: 16px">
        <div class="flex-scrollable-container">
          <div class="flex-scrollable-y">
            <div class="column" style="margin: 16px">
              ${Array.from(this.applets.entries()).map(
                ([appletId, { appletClient, profilesClient }]) =>
                  html`
                    <profiles-context
                      .store=${new ProfilesStore(profilesClient)}
                    >
                      <syn-context
                        .store=${new SynStore(
                          new SynClient(appletClient, "notebooks")
                        )}
                      >
                        <div class="row title" style="align-items: center">
                          <span>${msg("Notes")} ${msg("in")} </span>
                          ${applets
                            .get(appletId)
                            ?.groupsIds.map(
                              (groupId) => html`
                                <img
                                  .src=${groupsProfiles.get(groupId)?.logo_src}
                                  alt="group-${groupsProfiles.get(groupId)
                                    ?.name}"
                                  style="margin-right: 4px; height: 32px; width: 32px; border-radius: 50%"
                                />
                              `
                            )}
                          <span>${applets.get(appletId)?.appletName}</span>
                        </div>
                        <all-notes
                          style="margin: 16px; 0"
                          @note-selected=${async (e: CustomEvent) => {
                            const appInfo = await appletClient.appInfo();
                            const dnaHash = (
                              appInfo.cell_info.notebooks[0] as any
                            )[CellType.Provisioned].cell_id[0];
                            this.weServices.openViews.openHrl(
                              [dnaHash, e.detail.noteHash],
                              {}
                            );
                          }}
                        ></all-notes>
                      </syn-context>
                    </profiles-context>
                  `
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    switch (this.appletsInfo.value.status) {
      case "pending":
        return html`<div class="row center-content" style="flex:1">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case "complete":
        return this.renderNotes(
          this.appletsInfo.value.value.appletsInfos,
          this.appletsInfo.value.value.groupsProfiles
        );
      case "error":
        return html`<display-error
          .headline=${msg("Error fetching the applets")}
          .error=${this.appletsInfo.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }
    `,
    sharedStyles,
  ];
}
