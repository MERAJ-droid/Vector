import * as Y from 'yjs';
import type { editor, IDisposable } from 'monaco-editor';
import type { Awareness } from 'y-protocols/awareness';

/**
 * MonacoBinding - Binds a Yjs Y.Text to a Monaco Editor instance
 * Enables two-way synchronization for collaborative editing
 */
export class MonacoBinding {
  private ytext: Y.Text;
  private monacoModel: editor.ITextModel;
  private awareness: Awareness | null;
  private _monacoChangeHandler: IDisposable | null = null;
  private _ytextObserver: ((event: Y.YTextEvent) => void) | null = null;
  private _mux = createMutex();
  private _readOnlyMode: boolean = false;

  constructor(
    ytext: Y.Text,
    monacoModel: editor.ITextModel,
    awareness: Awareness | null = null,
    readOnlyMode: boolean = false,
    skipInitialSync: boolean = false
  ) {
    this.ytext = ytext;
    this.monacoModel = monacoModel;
    this.awareness = awareness;
    this._readOnlyMode = readOnlyMode;

    // Initial sync from Yjs to Monaco.
    // skipInitialSync=true when Monaco already has the correct content (e.g. after
    // a restore where we set model.setValue() before reconnecting YJS). In that case
    // ytext is still empty and we must NOT overwrite Monaco's content with "".
    if (!skipInitialSync) {
      const ytextValue = ytext.toString();
      if (monacoModel.getValue() !== ytextValue) {
        monacoModel.setValue(ytextValue);
      }
    }

    // Listen to Yjs changes and update Monaco
    this._ytextObserver = (event: Y.YTextEvent) => {
      console.log('🔔 Y.Text observer triggered:', event.delta);
      this._mux(() => {
        try {
          console.log(`🔓 Inside mutex, processing delta... Initial model length: ${monacoModel.getValueLength()}`);
          let index = 0;
          event.delta.forEach((delta: any) => {
            if (delta.retain !== undefined) {
              console.log('  ↪️ Retain:', delta.retain);
              index += delta.retain;
            } else if (delta.insert !== undefined) {
              const pos = monacoModel.getPositionAt(index);
              const insert = typeof delta.insert === 'string' ? delta.insert : '';
              console.log('  ➕ Insert at', index, '(pos:', pos.lineNumber, ':', pos.column, '), length:', insert.length);
              monacoModel.applyEdits([
                {
                  range: {
                    startLineNumber: pos.lineNumber,
                    startColumn: pos.column,
                    endLineNumber: pos.lineNumber,
                    endColumn: pos.column,
                  },
                  text: insert,
                },
              ]);
              index += insert.length;
            } else if (delta.delete !== undefined) {
              const pos = monacoModel.getPositionAt(index);
              const endPos = monacoModel.getPositionAt(index + delta.delete);
              console.log('  ➖ Delete from', index, 'to', index + delta.delete, '(pos:', pos.lineNumber, ':', pos.column, 'to', endPos.lineNumber, ':', endPos.column, ')');
              monacoModel.applyEdits([
                {
                  range: {
                    startLineNumber: pos.lineNumber,
                    startColumn: pos.column,
                    endLineNumber: endPos.lineNumber,
                    endColumn: endPos.column,
                  },
                  text: '',
                },
              ]);
            }
          });
          console.log(`✅ Delta processing complete. Final model length: ${monacoModel.getValueLength()}`);
        } catch (error) {
          console.error('❌ Error processing Yjs delta:', error);
        }
      });
    };

    ytext.observe(this._ytextObserver);

    // Listen to Monaco changes and update Yjs
    this._monacoChangeHandler = monacoModel.onDidChangeContent((event) => {
      console.log('⌨️ Monaco change detected:', event.changes.length, 'changes');

      // Don't propagate changes to Yjs if in read-only mode
      if (this._readOnlyMode) {
        console.log('🚫 Read-only mode - blocking local changes from syncing to Yjs');
        return;
      }

      this._mux(() => {
        try {
          console.log('🔓 Inside mutex, updating Y.Text...');
          ytext.doc?.transact(() => {
            event.changes
              .sort((a, b) => b.rangeOffset - a.rangeOffset)
              .forEach((change) => {
                console.log('  📝 Change at', change.rangeOffset, ':',
                  'delete', change.rangeLength, 'insert length', change.text.length);
                ytext.delete(change.rangeOffset, change.rangeLength);
                ytext.insert(change.rangeOffset, change.text);
              });
          }, this);
          console.log(`✅ Y.Text update complete. Y.Text length: ${ytext.length}`);
        } catch (error) {
          console.error('❌ Error updating Yjs:', error);
        }
      });
    });
  }

  /**
   * Update the read-only mode of the binding
   * When true, local changes won't be propagated to Yjs
   */
  setReadOnlyMode(readOnly: boolean) {
    console.log(`🔒 MonacoBinding: Setting readOnly mode to ${readOnly}`);
    this._readOnlyMode = readOnly;
  }

  destroy() {
    if (this._ytextObserver) {
      this.ytext.unobserve(this._ytextObserver);
    }
    if (this._monacoChangeHandler) {
      this._monacoChangeHandler.dispose();
    }
  }
}

/**
 * Creates a mutex to prevent re-entrant execution
 * Used to avoid infinite loops when syncing between Yjs and Monaco
 */
function createMutex() {
  let token = true;
  return (f: () => void) => {
    if (token) {
      token = false;
      try {
        f();
      } finally {
        token = true;
      }
    }
  };
}
