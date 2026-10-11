import { Box, Typography } from '@strapi/design-system';
import styled from 'styled-components';

/**
 * What the message list shows before the first message: a title and one sentence. Centred in both directions, as in strapi-plugin-tanstack-ai
 * 1.6.0 (`MessageList.tsx`). It has no buttons: the questions to press are the quick questions above the text box (QuickQuestions.tsx), which stay
 * for the whole chat, and this does not repeat them.
 */
const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
`;

const Sentence = styled.div`
  max-width: 520px;
`;

export const EmptyState = () => (
  <Wrapper>
    <Typography variant="beta" textColor="neutral400">
      Ask Maison
    </Typography>
    <Box paddingTop={2}>
      <Sentence>
        <Typography variant="omega" textColor="neutral500">
          Ask about visit requests, customer questions and inquiries. The assistant looks things up and never sends, confirms or changes anything.
        </Typography>
      </Sentence>
    </Box>
  </Wrapper>
);
