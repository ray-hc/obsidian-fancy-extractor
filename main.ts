import { Plugin, Notice, Modal, App, MarkdownView, Editor, TFile, PluginSettingTab, Setting, normalizePath, moment } from 'obsidian';
import { removeStopwords } from "stopword";

export default class FancyExtractPlugin extends Plugin {
  settings: FancyExtractSettings;

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }



	async onload() {
    await this.loadSettings();
    this.addSettingTab(new FancyExtractSettingTab(this.app, this));
		this.addCommand({
			id: 'open-name-modal',
			name: 'Extract (Open Name Modal)',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
        this.checkAndExtractText(checking, editor, view, true)
      }
		});
    this.addCommand({
			id: 'use-default-name',
			name: 'Extract (Use Default Name)',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
        this.checkAndExtractText(checking, editor, view, false)
      }
		});
	}

  async checkAndExtractText(checking: boolean, editor: Editor, view: MarkdownView, openModal: boolean) {
    const selectedText = editor.getSelection().trim();
    const currFile = view.file;
    if (selectedText && currFile) {
      if (!checking) {
        this.extractText(editor, view, openModal, selectedText, currFile);
      }
      return true;
    }
    return false;
  }

	async extractText(editor: Editor, view: MarkdownView, openModal: boolean, selectedText: string, currFile: TFile) {
    const defaultName = getDefaultName(selectedText, this.settings);
    if (openModal) {
      // Open modal, which will name extract on callback.
      new ExtractModal(this.app, defaultName, (noteName) => this.createExtract(editor, selectedText, currFile, noteName)).open();
    } else {
      // If use default, call createExtract now.
      this.createExtract(editor, selectedText, currFile, defaultName);
    }
	}

  async createExtract(editor: Editor, selectedText: string, currFile: TFile, noteName: string): Promise<void> {
    // First, new note will be placed in current folder.
    // If not final location, will append unique ID to ensure no naming conflicts.
    const currentFolder = currFile.parent?.path || '/';
    const uniqueID = this.settings.extractFolder != "" ? getUniqueID() : "";

    // Place new note.
    const fp = normalizePath(`${currentFolder}/${noteName}${uniqueID}.md`);
    const note: TFile = await this.app.vault.create(fp, selectedText);

    // If using subfolder, move file there. 
    // By switching folders as secondary step, ensures Obsidian will update links.
    if (this.settings.extractFolder) {
      const extractFolder = `${currentFolder}/${replaceDatePlaceholder(this.settings.extractFolder)}`;
      await this.app.vault.createFolder(extractFolder).catch(() => {});
      const newFp = normalizePath(`${extractFolder}/${noteName}.md`);
      await this.app.fileManager.renameFile(note, newFp).catch(
        () => {
          new Notice(`Couldn't move new file into ${extractFolder}.`);
        }
      );
    }
    // Update original note with link.
    const linkToNote = this.app.fileManager.generateMarkdownLink(note, currFile.path);

    if (this.settings.textAfterExtraction == "embed") {
      editor.replaceSelection(`!${linkToNote}`);
    } else if (this.settings.textAfterExtraction == "link"){
      editor.replaceSelection(`${linkToNote}`);
    } else {
      editor.replaceSelection("");
    }
    
    // Notify user.
    new Notice(`Extracted text to ${note.path}`);
  }
}

export function getDefaultName(selectedText: string, settings: FancyExtractSettings) {
  const noteName = getFormatWithNWords(selectedText, settings);
  return replaceDatePlaceholder(noteName);
}

// Calculate the {WORDS:N} variable value and return settings.format with "{WORDS:N}" replaced by value.
function getFormatWithNWords(selectedText: string, settings: FancyExtractSettings): string {
  const firstBlock = selectedText.split("\n\n")[0];
  const words = firstBlock.toLowerCase().replace(/[^a-z\s]/g, "").match(/\b\w+\b/g) || [];
  const kw = (settings.customStopwords == "")
    ? removeStopwords(words)
    : removeStopwords(words, settings.customStopwords.split(" "));

  // Match only {nWords=number}
  const nWordsPattern = /\{WORDS:(\d+)\}/g;

  const format = settings.format.replace(nWordsPattern, (_, n) => {
    const count = parseInt(n, 10);
    const firstNWords = kw.slice(0, count).join("-");
    return firstNWords;
  });

  return format;
}


function replaceDatePlaceholder(str: string): string {
  return str.replace(/\{DATE:([^}]+)\}/g, (_, format) => moment().format(format));
}

function getUniqueID(): string {
  return Math.random().toString(36).substring(2, 7);
}

class ExtractModal extends Modal {
	private submitCallback: (noteName: string) => void;
  private defaultName: string;

	constructor(app: App, defaultName: string, onSubmitCallback: (noteName: string) => void) {
		super(app);
    this.defaultName = defaultName;
		this.submitCallback = onSubmitCallback;
	}

  onSubmit(noteName: string) {
    if (noteName) {
      this.submitCallback(noteName);
      this.close();
    } else {
      new Notice('Please provide a note name.');
    }
  }

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h1', { text: 'Naming Extracted Note' });
    const input = contentEl.createEl('input', { type: 'text', value: this.defaultName, cls: "extract" });
		input.focus();
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            this.onSubmit(input.value.trim());
        }
    });
		contentEl.createEl('button', { text: 'Submit' }).addEventListener('click', () => this.onSubmit(input.value.trim()));
	}

  onClose() {
      const { contentEl } = this;
      contentEl.empty();
  }
}

interface FancyExtractSettings {
  textAfterExtraction: string;
  extractFolder: string;
  format: string;
  nWords: number;
  customStopwords: string;
}

const DEFAULT_SETTINGS: FancyExtractSettings = {
  textAfterExtraction: "embed",
  extractFolder: "extracts",
  format: "{DATE:YYYY-MM-DD}_{WORDS:3}",
  customStopwords: "",
  nWords: 5,
}

export class FancyExtractSettingTab extends PluginSettingTab {
  plugin: FancyExtractPlugin;

  constructor(app: App, plugin: FancyExtractPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('Relative path to extracts folder')
      .setDesc('May use {DATE:format} where format is a valid Moment format. Leave blank to place extracts in current folder.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.extractFolder)
          .onChange(async (value) => {
            this.plugin.settings.extractFolder = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Text after extraction")
      .setDesc("What to show in place of selected text after extracting it.")
      .addDropdown(dropdown =>
        dropdown
            .addOptions({
                embed: "Embed new file",
                link: "Link to new file",
                none: "None"
            })
            .setValue(this.plugin.settings.textAfterExtraction)
            .onChange(async (value) => {
                this.plugin.settings.textAfterExtraction = value;
                await this.plugin.saveSettings();
            })
    );
    new Setting(containerEl).setName('Default note name').setHeading();
    new Setting(containerEl)
      .setName('Format')
      .setDesc('Format for new file names. Use {WORDS:N} to insert the first N words of the selected text\'s first block. Use {DATE:format} to insert current date/time, where format is a valid Moment format.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.format)
          .onChange(async (value) => {
            if (value == "") {
              new Notice("Please enter a non-empty string for format.");
            } else {
              this.plugin.settings.format = value;
              await this.plugin.saveSettings();
            }
          })
      );
    new Setting(containerEl)
      .setName('Custom words to filter')
      .setDesc('Space-seperated list of words to ignore when calculating the WORDS variable. If blank, default English stopwords are used (as defined by npm `stopword` module).')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.customStopwords)
          .onChange(async (value) => {
            this.plugin.settings.customStopwords = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
