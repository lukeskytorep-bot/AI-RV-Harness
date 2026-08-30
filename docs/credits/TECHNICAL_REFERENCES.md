# Technical references and acknowledgement policy

AI RV Harness uses official documentation, public issue reports, research papers, and open-source repositories to understand interoperability problems and established engineering patterns.

## How references may influence the project

Reference material may help identify provider response formats and incompatibilities, separation of reasoning from final content, known failure modes, recovery patterns, state and memory risks, testing strategies, and documentation practices.

Reviewing a public implementation or issue discussion does not by itself mean that its source code was copied or incorporated. When third-party code is incorporated, its licence and required notices must be handled separately and explicitly.

## Referenced areas

### Provider responses and reasoning compatibility

- [Open WebUI](https://github.com/open-webui/open-webui)
- [OpenRouter documentation](https://openrouter.ai/docs/)
- official provider API documentation for documented response formats

The v0.7.11 response normalizer, parser, Monitor integration, recovery rules, and tests were designed specifically for AI RV Harness after comparative research into these formats and failure modes.

### Viewer Notes and AI memory research

- [Letta / MemGPT](https://github.com/letta-ai/letta)
- [LangGraph](https://github.com/langchain-ai/langgraph)
- [LangMem](https://github.com/langchain-ai/langmem)
- [Mem0](https://github.com/mem0ai/mem0)
- [Open WebUI Memory](https://docs.openwebui.com/features/chat-conversations/memory/)
- [Reflexion](https://github.com/noahshinn/reflexion)
- [Voyager](https://github.com/MineDojo/Voyager)

The planned AI Center and Viewer Notes design remains project-specific. Its intended safeguards include immutable session snapshots, complete note-version replacement, model-owned note decisions, strict Profile/model scoping, Research locks, and updates only after the RV Reveal boundary defined by the session flow.

## Attribution categories

- **Credits:** people and named AI collaborators who contributed to the project.
- **Advisory acknowledgements:** reviewers, testers, issue reporters, and documentation advisers whose contribution did not constitute source-code authorship.
- **Technical references:** projects and publications used for comparative learning or engineering research.
- **Third-party notices:** legally required attribution for incorporated or redistributed dependencies and other material.

Listing a project or provider as a technical reference does not imply its sponsorship, affiliation, approval, or endorsement of AI RV Harness.
