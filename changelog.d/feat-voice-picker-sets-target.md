### Changed

- An agent you choose in the voice picker (Option+K) becomes the target of the next dictation shortcut (Option+V), also when you close the picker without sending. It wins over the default agent until you quit OpenBot.
- Fixed: the first press of a global voice shortcut after launch could leave an empty, invisible window, so Control+K and Control+V seemed to do nothing. The window now gets its opening once it has loaded.
- Fixed the voice picker opening blank: a status animation crashed the window when it first drew.
- The voice window no longer blocks clicks on the apps below it. Only the visible island takes clicks.
