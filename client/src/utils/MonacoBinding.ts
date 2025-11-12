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

  constructor(
    ytext: Y.Text,
    monacoModel: editor.ITextModel,
    awareness: Awareness | null = null
  ) {
    this.ytext = ytext;
    this.monacoModel = monacoModel;
    this.awareness = awareness;

    // Initial sync from Yjs to Monaco
    const ytextValue = ytext.toString();
    if (monacoModel.getValue() !== ytextValue) {
      monacoModel.setValue(ytextValue);
    }

    // Listen to Yjs changes and update Monaco
    this._ytextObserver = (event: Y.YTextEvent) => {
      console.log('🔔 Y.Text observer triggered:', event.delta);
      this._mux(() => {
        console.log('🔓 Inside mutex, processing delta...');
        let index = 0;
        event.delta.forEach((delta: any) => {
          if (delta.retain !== undefined) {
            console.log('  ↪️ Retain:', delta.retain);
            index += delta.retain;
          } else if (delta.insert !== undefined) {
            const pos = monacoModel.getPositionAt(index);
            const insert = typeof delta.insert === 'string' ? delta.insert : '';
            console.log('  ➕ Insert at', index, ':', insert);
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
            console.log('  ➖ Delete from', index, 'to', index + delta.delete);
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
        console.log('✅ Delta processing complete');
      });
    };

    ytext.observe(this._ytextObserver);

    // Listen to Monaco changes and update Yjs
    this._monacoChangeHandler = monacoModel.onDidChangeContent((event) => {
      console.log('⌨️ Monaco change detected:', event.changes.length, 'changes');
      this._mux(() => {
        console.log('🔓 Inside mutex, updating Y.Text...');
        ytext.doc?.transact(() => {
          event.changes
            .sort((a, b) => b.rangeOffset - a.rangeOffset)
            .forEach((change) => {
              console.log('  📝 Change at', change.rangeOffset, ':', 
                'delete', change.rangeLength, 'insert', change.text.substring(0, 20));
              ytext.delete(change.rangeOffset, change.rangeLength);
              ytext.insert(change.rangeOffset, change.text);
            });
        }, this);
        console.log('✅ Y.Text update complete');
      });
    });
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
