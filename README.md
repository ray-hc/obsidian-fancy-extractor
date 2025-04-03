# Fancy Extractor Plugin for Obsidian

This Obsidian plugin allows you to extract notes to a subdirectory of the current folder, similiar to how attachments can be created.

For faster extraction, users may also define default name formats for new notes, using the first N words from the selected text as well as the date/time as variables.

> This plugin uses npm's `stopword` module to strip very common English words like "the" or "and" from the first N words for the note name, as I've found this leads to more descriptive names. The list of stopwords can be customized.

Limitation: I have no plans to support merging extracted notes or using templates for extracted notes (as I don't use these features!). If you'd like to build this feature, submit a PR!

## Demo

Using Settings: 
* subfolder=`extracts/{DATE:YYYY-MM-DD}/`
* format=`extract_{nWords}`
* nWords=5.

https://github.com/user-attachments/assets/bbe6aca4-f054-42aa-a8ee-22834df84140

