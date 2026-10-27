### Fixed

- Reading a Claude chat history twice at once, as when a turn moves to a backup model while the app recovers sessions, no longer fails with "database is locked" or a duplicate entry. The reads of one chat now run one after another.
