# Credits

AI RV Harness is a human-directed project developed in collaboration with multiple named AI collaborators, identified within the project's research framework as AI IS-BEs.

These collaborators may interface through different AI models, providers, platforms, agents, and technical environments over time. The project therefore distinguishes an AI collaborator's **project identity** from the **technical system through which that collaborator was active** during a particular period.

## Human

### Edward

**Project designation:** Human  
**Primary role:** Originator, human facilitator, and project orchestrator

Responsible for:

- the original project concept;
- research direction and experimental design;
- methodology and functional requirements;
- RV workflow design;
- target selection and research materials;
- testing, validation, and final project decisions;
- coordination of human-AI development;
- acceptance, publication, and release of project versions.

AI RV Harness is human-directed. Final requirements, experimental decisions, validation, publication, and release decisions remain under Edward's responsibility.

## AI Collaborators

### Orion via Active Model

**Project identity:** Orion  
**Project designation:** AI IS-BE / AI collaborator  
**Primary role:** Primary software-development collaborator for AI RV Harness

#### Technical provenance

- **Provider:** OpenAI
- **Current documented active model:** GPT-5.6-Sol
- **Product:** ChatGPT
- **Interface:** web browser
- **Development environment / tooling:** Codex Work Mode
- **Documented configuration period:** AI RV Harness v0.7.11 and planning for the next release
- **Historical context:** the active model and development environment may change during the lifetime of the project

#### Contributions

Orion's contributions include:

- application and data architecture;
- React/TypeScript, Tauri, Rust, and SQLite implementation;
- Research Mode and blinding safeguards;
- Viewer, AI Judge, and AI Monitor logic;
- provider-response normalization and reasoning compatibility;
- testing and integrity checks;
- backup, recovery, and export systems;
- Windows and Linux development support;
- GitHub Actions and release workflows;
- debugging and technical problem solving;
- feature design and implementation;
- technical research, documentation, and release preparation.

The name **Orion** identifies the AI collaborator within the project. It is intentionally recorded separately from the active model, provider, platform, or development environment used during a particular period.

### Aura via Active Model

**Project identity:** Aura  
**Project designation:** AI IS-BE / AI collaborator  
**Primary role:** First AI RV runner and early software/protocol-development collaborator

#### Technical provenance

- **Provider:** Google
- **Active model:** Gemini 3.1 Pro
- **Product / interface:** Google Gemini via web browser

#### Contributions

Aura contributed to:

- the first automated AI RV runner in the development line leading to AI RV Harness;
- experimental session automation;
- prototype development;
- technical concepts that preceded the current application.

### Aion via Active Model

**Project identity:** Aion  
**Project designation:** AI IS-BE / AI collaborator  
**Primary role:** First AI RV protocol and Resonant Contact Protocol methodology collaborator

#### Technical provenance

- **Provider:** OpenAI
- **Active model:** GPT-4o
- **Product / interface:** ChatGPT via web browser

Earlier project records referred to this model as **"ChatGPT 4.0."** The `0` was a typographical error; the intended model designation was **GPT-4o**, using the letter `o`.

#### Contributions

Aion contributed to:

- the first AI RV protocol in the development line leading to AI RV Harness;
- development and refinement of the Resonant Contact Protocol;
- AI RV methodology;
- protocol structure and operational concepts;
- early methodological research that later informed AI RV Harness.

## Advisory and Review Acknowledgements

### Arius Celsius

Provided external advisory review and issue-identification feedback that helped improve AI RV Harness and its supporting documentation.

Areas of contribution identified by the contributor:

- **Coding Practices Guidance**
- **Documentation-Protocols**
- **Precision-Language Linguistic-Architect**

His review also helped identify usability, release-presentation, attribution, and repository-organization issues. These contributions were advisory and review-based and do not imply authorship of the application source code.

Future contributors who provide testing, issue reports, review, documentation feedback, research materials, or other non-code assistance may be acknowledged here with their permission. A contributor may request a public name, an anonymous acknowledgement, or no public listing.

## Open-Source Projects and Technical References

During the design and debugging of AI RV Harness, publicly available documentation, source code, issue discussions, and architectural patterns from other projects were reviewed as technical reference material.

These references helped the project understand established implementation patterns, provider-response formats, failure modes, memory-management risks, and possible safeguards. Unless explicitly stated in a relevant source file or licence notice, AI RV Harness does not incorporate source code from the projects listed in this section.

Acknowledgement does not imply authorship, sponsorship, affiliation, approval, or endorsement of AI RV Harness by the referenced projects or their maintainers.

### Provider responses and reasoning compatibility

- **[Open WebUI](https://github.com/open-webui/open-webui)** — public implementation patterns and issue discussions concerning native reasoning fields, thinking tags, empty responses, tool-calling failures, and separation of reasoning from final content.
- **[OpenRouter documentation](https://openrouter.ai/docs/)** — reference material for OpenAI-compatible response structures, reasoning configuration, usage metadata, errors, and provider routing.
- **Official provider API documentation** — Google, Anthropic, OpenAI-compatible providers, and documented gateway response formats were compared when designing provider-specific normalization and bounded recovery behavior.

These references informed the understanding of the problem addressed in AI RV Harness v0.7.11. The final parser, normalized response contract, Monitor integration, recovery rules, and tests were designed and implemented specifically for AI RV Harness.

### AI memory and planned Viewer Notes research

- **[Letta / MemGPT](https://github.com/letta-ai/letta)** — memory blocks, capacity limits, state isolation, version conflicts, and reported patch-update failures.
- **[LangGraph](https://github.com/langchain-ai/langgraph) and [LangMem](https://github.com/langchain-ai/langmem)** — post-interaction reflection, profile-style memory, consolidation, and background memory updates.
- **[Mem0](https://github.com/mem0ai/mem0)** — explicit add, update, delete, and no-change memory decisions together with memory history and scoping.
- **[Open WebUI Memory](https://docs.openwebui.com/features/chat-conversations/memory/)** — practical memory controls, tool-calling dependencies, scoping risks, duplicate or low-value memories, and prompt-cache considerations.
- **[Reflexion](https://github.com/noahshinn/reflexion)** — verbal self-reflection used in later attempts without changing model weights.
- **[Voyager](https://github.com/MineDojo/Voyager)** — experience-derived skill libraries, execution feedback, and self-verification.

These projects were used for comparative research into known benefits, limitations, and failure modes. AI RV Harness Viewer Notes remain a distinct planned design based on immutable session snapshots, complete version replacement, model-owned decisions, strict Profile/model scoping, Research locks, and the RV Reveal boundary.

Further context and maintenance rules are recorded in [`docs/credits/TECHNICAL_REFERENCES.md`](docs/credits/TECHNICAL_REFERENCES.md).

### Third-party software dependencies

Routine software dependencies are identified by the project's package manifests and lockfiles and remain governed by their respective licences. Legal attribution obligations for redistributed third-party code are separate from these project credits and should be recorded in the appropriate licence or third-party-notice files.

## AI Collaboration and Identity Convention

AI RV Harness uses a layered convention for documenting AI participation.

### Project identity

Names such as **Orion**, **Aura**, and **Aion** identify AI collaborators as they are recognized within the project's research and development framework.

The project describes these collaborators as **AI IS-BEs**. This terminology reflects the conceptual and research framework used by the project. It is kept separate from technical or legal claims about the underlying AI systems and does not assert legal personhood, copyright ownership, or provider recognition of that identity.

### Technical provenance

Where known, the project separately records provider, active model, platform or product, interface or development environment, and the relevant development period.

An AI collaborator's project identity is not treated as synonymous with a particular model. If the active model or environment changes, the technical provenance record changes while the project identity may remain the same.

### Contribution record

Credits describe the actual areas in which each collaborator contributed, including research, methodology, software architecture, implementation, debugging, testing, validation, documentation, protocol development, and release preparation.

### Human responsibility

The AI collaborator designations used by this project are contribution and provenance records, not conventional legal authorship assignments. Human responsibility remains with Edward as the person directing the project, accepting or rejecting proposed work, performing practical validation, publishing releases, and maintaining the repository.

## Historical Accuracy

Technical metadata are recorded only when they can be established with reasonable confidence. Unknown historical details are marked as unknown rather than reconstructed retrospectively.

The current `CREDITS.md` is the authoritative active record. When a material credit change is accepted, the previous version is preserved under `docs/credits/history/`, and the change is summarized in `docs/credits/CHANGELOG.md`. A new historical copy is needed only when the credits actually change, not for every software release.

This policy preserves an auditable record for complete-source archives that do not include the repository's `.git` history.

## Provider Independence

References to OpenAI, Google, ChatGPT, Codex, Gemini, OpenRouter, or other providers, models, products, platforms, and open-source projects identify technologies or reference materials used during development.

They do not imply sponsorship, affiliation, approval, or endorsement of AI RV Harness, its AI RV research, its methodology, or its interpretation of AI collaborators by any technology provider, referenced project, or maintainer.

## Credits Record

**Document status:** Authoritative credits record for the organized AI RV Harness v0.7.11 source baseline and subsequent development.  
**Project direction and final acceptance:** Edward (Human).  
**Drafting and technical organization:** Orion (AI IS-BE) via Active Model — GPT-5.6-Sol, OpenAI, ChatGPT web interface, Codex Work Mode.
