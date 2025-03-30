import { Plugin, Notice, Modal, App, MarkdownView, Editor, TFile, moment, PluginSettingTab, Setting } from 'obsidian';
import { removeStopwords } from "stopword";

export default class ExtractToSubdirPlugin extends Plugin {
  settings: ExtractSubdirSettings;

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

	async onload() {
    await this.loadSettings();
    this.addSettingTab(new ExtractSubdirSettingTab(this.app, this));
		this.addCommand({
			id: 'extract-to-subdir',
			name: 'Extract to note in subdirectory',
			editorCallback: (editor, view: MarkdownView) => this.extractText(editor, view)
		});
	}


	async extractText(editor: Editor, view: MarkdownView) {
		const selectedText = editor.getSelection().trim();
		if (!selectedText) {
			new Notice('No text selected to extract.');
			return;
		}			
    const currentFile = view.file;
    if (!currentFile) {
      new Notice("Couldn't determine current file.");
      return;
    }
    const defaultName = getNoteName(selectedText, this.settings.defaultPrefix, this.settings.firstNWords, this.settings.customStopwords);

		new ExtractModal(this.app, defaultName, async (noteName) => {
      // Create extracts folder if none exist.
			const parentFolder = currentFile.parent?.path || '/';
      const extractsFolderPath = `${parentFolder}/${this.settings.subdir}`;
			await this.app.vault.createFolder(extractsFolderPath).catch(() => {});

      // Create child note in current directory first, using current time to provide unique identifier.
      const initialFilePath = `${parentFolder}/${noteName}-${moment().format("YYYYMMDDHHmm")}.md`;
			const note: TFile = await this.app.vault.create(initialFilePath, selectedText);

      // Move child note into extracts folder. 
      // By moving the file via fileManager, Obsidian will automatically update links included in extractedText.
			const newFilePath = `${extractsFolderPath}/${noteName}.md`;
      await this.app.fileManager.renameFile(note, newFilePath).catch(
        () => {
          new Notice("Couldn't move new file into subdirectory.");
        }
      );

      // Update original note with link.
      const linkToNote = this.app.fileManager.generateMarkdownLink(note, currentFile.path);
      editor.replaceSelection(`!${linkToNote}`);

      // Notify user.
			new Notice(`Extracted text to ${note.path}`);
		}).open();
	}
}

export function getNoteName(text: string, prefix: string, firstNWords: number, customStopwords: string) {
  const firstBlock = text.split("\n\n")[0];
  const words = firstBlock.toLowerCase().replace(/[^a-z\s]/g, "").match(/\b\w+\b/g) || [];
  const kw = (customStopwords == "") ? removeStopwords(words) : removeStopwords(words, customStopwords.split(" "))
  return `${prefix}${kw.slice(0, firstNWords).join("-")}`;
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

interface ExtractSubdirSettings {
  textAfterExtraction: string;
  subdir: string;
  defaultPrefix: string;
  firstNWords: number;
  customStopwords: string;
}

const DEFAULT_SETTINGS: ExtractSubdirSettings = {
  textAfterExtraction: "embed",
  subdir: "notes",
  defaultPrefix: "",
  customStopwords: "",
  firstNWords: 5,
}

export class ExtractSubdirSettingTab extends PluginSettingTab {
  plugin: ExtractToSubdirPlugin;

  constructor(app: App, plugin: ExtractToSubdirPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", {text: "General Settings"});
    new Setting(containerEl)
      .setName('Subfolder Name')
      .setDesc('Name of folder to place extracted notes.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.subdir)
          .onChange(async (value) => {
            this.plugin.settings.subdir = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Text After Extraction")
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
    containerEl.createEl("h2", {text: "Default Name Settings"});
    containerEl.createEl("p", {text: "The selected text's first block's first N words are used as the default note name. This plugin uses the `stopword` npm module to filter out English stopwords (very common words like 'the' or 'of') from the name."})
    new Setting(containerEl)
      .setName('Prefix')
      .setDesc('String to start name.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.defaultPrefix)
          .onChange(async (value) => {
            this.plugin.settings.defaultPrefix = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
    .setName("First N Words")
    .setDesc("Number of words copied from selected text to name. To disable, use '0'.")
    .addText(text => 
        text
            .setPlaceholder("Enter a number")
            .setValue(this.plugin.settings.firstNWords.toString())
            .onChange(async (value) => {
                const numValue = parseInt(value, 10);
                if (!isNaN(numValue) && numValue >= 0) {
                    this.plugin.settings.firstNWords = numValue;
                    await this.plugin.saveSettings();
                } else {
                  new Notice("Please enter a valid non-negative number.");
              }
            })
    );
    new Setting(containerEl)
      .setName('Custom Words to Filter')
      .setDesc('Comma-seperated list of words to ignore when when copying words from selected text. If blank, default English stopwords are used.')
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
