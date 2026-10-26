### Fixed

- In a channel with more than one agent, you can now say a member's name to send it the message,
  with no mention. A message with two names goes to both members. A message to the whole channel,
  such as "hey guys" or "everyone", goes to all members (at most 3, the lead first), and each one
  answers. Before, such a message often stopped with "The channel lead could not route this
  message" and waited for **Continue** or **Reassign**.
- When the lead cannot tell who should do a request, it now asks you a short question in the
  channel. The request does not stop. When two members have the same name, the lead asks which one
  you mean. **Continue** and **Reassign** stay for real routing failures.
