# ZIP uploads

ZIP files use the chat's existing file upload, message attachment and download
paths, with the existing 25 MB per-file limit and private attachment storage.
The upload does not extract archive contents.

```sh
pnpm exec vitest run src/lib/composer-attachments.test.ts server/attachments.test.ts server/message-file.test.ts server/zip-upload.e2e.test.ts
pnpm exec vitest run server/index.test.ts -t 'streams shared documents safely'
```

The ZIP fixture launches an isolated server with a temporary home and fake
provider. It uploads a valid empty ZIP through the composer handler using the
Windows MIME alias, sends the resulting attachment in a chat, and downloads
it through the stored message. It checks the filename, ZIP MIME, nosniff header
and exact bytes. Unit coverage includes uppercase extensions and missing or
generic browser MIME types. This does not test archive extraction or provider
understanding of archive contents.

Set `OMB_VERIFICATION_ENTRY` to an absolute packaged `index.js` path to repeat
the fixture against the release server bundle.
