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
			id: 'fancy-extract-open-modal',
			name: 'Extract (Open Name Modal)',
			editorCallback: (editor, view: MarkdownView) => this.extractText(editor, view, true)
		});
    this.addCommand({
			id: 'fancy-extract-use-default',
			name: 'Extract (Use Default Name)',
			editorCallback: (editor, view: MarkdownView) => this.extractText(editor, view, false)
		});
	}

	async extractText(editor: Editor, view: MarkdownView, openModal: boolean) {
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
    const defaultName = getDefaultName(selectedText, this.settings);

    async function createExtract(currentFile: TFile, noteName: string, app: App, settings: FancyExtractSettings): Promise<void> {
			console.log(this);
      // First, new note will be placed in current folder.
      // If not final location, will append unique ID to ensure no naming conflicts.
      const currentFolder = currentFile.parent?.path || '/';
      const uniqueID = settings.useSubdir ? getUniqueID() : "";

      // Place new note.
      const fp = normalizePath(`${currentFolder}/${noteName}${uniqueID}.md`);
			const note: TFile = await app.vault.create(fp, selectedText);

      // If using subfolder, move file there. 
      // By switching folders as secondary step, ensures Obsidian will update links.
      if (settings.useSubdir) {
        const subdir = `${currentFolder}/${replaceDatePlaceholder(settings.subdir)}`;
        await app.vault.createFolder(subdir).catch(() => {});
        const newFp = normalizePath(`${subdir}/${noteName}.md`);
        await app.fileManager.renameFile(note, newFp).catch(
          () => {
            new Notice(`Couldn't move new file into ${subdir}.`);
          }
        );
      }
      // Update original note with link.
      const linkToNote = app.fileManager.generateMarkdownLink(note, currentFile.path);

      if (settings.textAfterExtraction == "embed") {
        editor.replaceSelection(`!${linkToNote}`);
      } else if (settings.textAfterExtraction == "link"){
        editor.replaceSelection(`${linkToNote}`);
      } else {
        editor.replaceSelection("");
      }
      
      // Notify user.
			new Notice(`Extracted text to ${note.path}`);
    }

    if (openModal) {
      new ExtractModal(this.app, defaultName, (noteName) => createExtract(currentFile, noteName, this.app, this.settings)).open();
    } else {
      createExtract(currentFile, defaultName, this.app, this.settings);
    }
	}
}

export function getDefaultName(selectedText: string, settings: FancyExtractSettings) {
  const noteName = getFormatWithNWords(selectedText, settings);
  return replaceDatePlaceholder(noteName);
}

// Calculate the {nWords} variable value and return settings.format with "{nWords}" replaced by value.
function getFormatWithNWords(selectedText: string, settings: FancyExtractSettings): string {
  const firstBlock = selectedText.split("\n\n")[0];
  const words = firstBlock.toLowerCase().replace(/[^a-z\s]/g, "").match(/\b\w+\b/g) || [];
  const kw = (settings.customStopwords == "") ? removeStopwords(words) : removeStopwords(words, settings.customStopwords.split(" "))
  const firstNWords = kw.slice(0, settings.nWords).join("-");
  return settings.format.replace(/\{nWords\}/g, firstNWords);
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
  subdir: string;
  useSubdir: boolean;
  format: string;
  nWords: number;
  customStopwords: string;
}

const DEFAULT_SETTINGS: FancyExtractSettings = {
  textAfterExtraction: "embed",
  subdir: "extracts",
  useSubdir: true,
  format: "{DATE:YYYY-MM-DD}_{nWords}",
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
      .setName('Subfolder Name')
      .setDesc('Name of folder to place extracted notes. May include multiple layers of folders. May use {DATE:format} where format is a valid Moment format.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.subdir)
          .onChange(async (value) => {
            this.plugin.settings.subdir = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName('Use Subfolder')
      .setDesc('If false, notes will be extracted to current folder.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useSubdir)
          .onChange(async (value) => {
            this.plugin.settings.useSubdir = value;
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
    new Setting(containerEl).setName('Default Note Name').setHeading();
    new Setting(containerEl)
      .setName('Format')
      .setDesc('Format for new file names. Available variables are {nWords}, the first N words of the selected text\'s first block, and {DATE:format}, where format is a valid Moment format.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.format)
          .onChange(async (value) => {
            this.plugin.settings.format = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
    .setName("First N Words")
    .setDesc("How many words to include in the {nWords} variable.")
    .addText(text => 
        text
            .setPlaceholder("Enter a positive number")
            .setValue(this.plugin.settings.nWords.toString())
            .onChange(async (value) => {
                const numValue = parseInt(value, 10);
                if (!isNaN(numValue) && numValue > 0) {
                    this.plugin.settings.nWords = numValue;
                    await this.plugin.saveSettings();
                } else {
                  new Notice("Please enter a positive integer.");
              }
            })
    );
    new Setting(containerEl)
      .setName('Custom Words to Filter')
      .setDesc('Space-seperated list of words to ignore when calculating the {nWords} variable. If blank, default English stopwords are used (as defined by npm `stopword` module).')
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
