import { css } from 'lit';

/** Highlight classes painted by both editors; depth = how many comments cover a piece. */
export const commentStyles = css`
  .nb-comment {
    background: rgba(255, 213, 79, 0.35);
    cursor: pointer;
    border-bottom: 1px solid rgba(255, 170, 0, 0.6);
  }
  .nb-depth-2 {
    background: rgba(255, 213, 79, 0.55);
  }
  .nb-depth-3 {
    background: rgba(255, 193, 7, 0.75);
  }
  .nb-comment-active {
    background: rgba(255, 170, 0, 0.6);
    box-shadow: 0 0 0 1px rgba(230, 140, 0, 0.9);
  }
  .nb-row {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    position: relative;
    flex: 1;
  }
  .nb-text {
    flex: 1;
    min-width: 0;
    position: relative;
  }
  .nb-add-comment {
    position: absolute;
    z-index: 5;
  }
`;
